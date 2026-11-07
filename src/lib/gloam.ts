import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { createPublicClient, http, isHex, type Hex, type PublicClient } from "viem";
import { getDb, schema } from "@/db";
import type { Gateway } from "@/db/schema";
import { TOKEN } from "@/lib/constants";
import { checkCashout, GLOAM_SCHEME, GLOAM_USDG, GLOAM_VAULT, grossFor, MAX_TAG, QUOTE_WINDOW_S, vaultFeeBps } from "@/lib/gloam-check";

// Gloam cash-out payments: an extra payment option on hosted gateways, for agents that pay from a private Gloam
// balance. The agent cashes out an exact amount from Gloam's vault to the gateway's splitter (or payee), through
// Gloam's relay, so the payment doesn't link to its wallet. The creator side is unchanged: the splitter receives
// normal USDG and splits it as usual. Autonomo holds no Gloam keys and no funds.
//
//   402    The usual x402 answer, plus one more `accepts` entry: scheme "gloam-cashout", the exact gross amount G to
//          cash out (price + the vault's fee + a tag that makes G unique per splitter among open quotes), and a
//          secret quote id that never goes on chain.
//   retry  X-PAYMENT: { scheme: "gloam-cashout", txHash, quoteId }, as JSON or base64 JSON. The quote must be this
//          gateway's, for this method and path; the transaction must be a Gloam cash-out of exactly G to payTo that
//          delivered at least the price, landed within 10 minutes of the quote, and was never used before.
//
// The payment lands before the call, so the transaction is locked while the API runs and only marked used once it
// answers below 400. A failed call releases it, and the agent can retry with the same transaction while the quote
// lasts.
//
// Env:
//   GLOAM_CASHOUT            Set to "off" to stop offering it everywhere. Unset: every gateway that accepts USDG.
//   ROBINHOOD_RPC_URL        Optional private RPC, as elsewhere.

/** How long after the 402 a quote can still be redeemed, including retries after a failed call. */
const QUOTE_TTL_S = QUOTE_WINDOW_S + 300;
/** Open quotes one visitor may hold at once, so nobody can use up a splitter's tags with unpaid 402s. */
const MAX_OPEN_PER_REQUESTER = 20;
/** How long a transaction stays locked while its call runs. Longer than the 25 s upstream timeout. */
const LOCK_S = 90;
/** Small tags first (under $0.001), the wider range only when those are taken. */
const SMALL_TAG = 999n;

const { gloamQuotes, gloamPayments } = schema;

/** Every gateway that accepts USDG offers it, unless GLOAM_CASHOUT=off. */
export function gloamEnabledFor(gateway: Pick<Gateway, "acceptUsdg">) {
  return gateway.acceptUsdg && process.env.GLOAM_CASHOUT?.trim().toLowerCase() !== "off";
}

let client: PublicClient | undefined;
function chain() {
  client ??= createPublicClient({ transport: http(process.env.ROBINHOOD_RPC_URL?.trim() || TOKEN.rpcUrl, { timeout: 10_000 }) }) as PublicClient;
  return client;
}

// The fee only changes through the vault's 3-day timelock, so a few minutes of caching can't put a quote under it.
let fee: { bps: bigint; until: number } | undefined;
async function feeBps() {
  if (fee && fee.until > Date.now()) return fee.bps;
  const bps = await vaultFeeBps(chain());
  fee = { bps, until: Date.now() + 5 * 60_000 };
  return bps;
}

function requesterOf(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`gloam:${ip}`).digest("hex").slice(0, 32);
}

function randomTag(max: bigint) {
  const n = BigInt(`0x${randomBytes(4).toString("hex")}`);
  return (n % max) + 1n;
}

export type GloamAccept = {
  scheme: typeof GLOAM_SCHEME;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { quoteId: string; vault: string; price: string; feeBps: number; header: string };
};

/**
 * Issues a quote for one request and returns the `accepts` entry for the 402, or null when none can be issued right
 * now (rate limit, no free tag, or the vault's fee couldn't be read). A null just leaves the Gloam option out.
 */
export async function issueGloamQuote(opts: { gateway: Gateway; request: Request; path: string; payTo: string; price: bigint }): Promise<GloamAccept | null> {
  const db = await getDb();
  const now = new Date();
  const payTo = opts.payTo.toLowerCase();
  const requester = requesterOf(opts.request);

  // Free the amounts of quotes that can no longer be redeemed.
  await db
    .update(gloamQuotes)
    .set({ open: false })
    .where(and(eq(gloamQuotes.open, true), lt(gloamQuotes.issuedAt, new Date(now.getTime() - QUOTE_TTL_S * 1000))));

  const [{ n }] = await db
    .select({ n: count() })
    .from(gloamQuotes)
    .where(and(eq(gloamQuotes.requester, requester), eq(gloamQuotes.open, true)));
  if (n >= MAX_OPEN_PER_REQUESTER) return null;

  let bps: bigint;
  try {
    bps = await feeBps();
  } catch (e) {
    console.error("gloam fee read failed", e);
    return null;
  }

  const id = randomBytes(18).toString("base64url");
  for (let attempt = 0; attempt < 12; attempt++) {
    const tag = randomTag(attempt < 6 ? SMALL_TAG : MAX_TAG);
    const gross = grossFor(opts.price, bps, tag);
    const inserted = await db
      .insert(gloamQuotes)
      .values({
        id,
        gatewayId: opts.gateway.id,
        method: opts.request.method,
        path: opts.path,
        payTo,
        gross: gross.toString(),
        price: opts.price.toString(),
        requester,
        issuedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: gloamQuotes.id });
    if (inserted.length) {
      return {
        scheme: GLOAM_SCHEME,
        network: TOKEN.network,
        amount: gross.toString(),
        asset: GLOAM_USDG,
        payTo: opts.payTo,
        maxTimeoutSeconds: QUOTE_WINDOW_S,
        extra: { quoteId: id, vault: GLOAM_VAULT, price: opts.price.toString(), feeBps: Number(bps), header: "X-PAYMENT" },
      };
    }
  }
  return null;
}

export type GloamPayment = { txHash: Hex; quoteId: string };

/** The Gloam payment a retry carries in X-PAYMENT (JSON or base64 JSON), or null. */
export function gloamPaymentOf(request: Request): GloamPayment | null {
  const raw = request.headers.get("x-payment");
  if (!raw) return null;
  let data: unknown;
  for (const text of [raw, Buffer.from(raw, "base64").toString("utf8")]) {
    try {
      data = JSON.parse(text);
      break;
    } catch {
      // Try the other encoding.
    }
  }
  const p = data as { scheme?: unknown; txHash?: unknown; quoteId?: unknown } | undefined;
  if (!p || p.scheme !== GLOAM_SCHEME) return null;
  if (typeof p.txHash !== "string" || !isHex(p.txHash) || p.txHash.length !== 66) return null;
  if (typeof p.quoteId !== "string" || p.quoteId.length > 64) return null;
  return { txHash: p.txHash.toLowerCase() as Hex, quoteId: p.quoteId };
}

export type Redeemed = { ok: true; received: bigint } | { ok: false; status: number; error: string; message: string };

/**
 * Checks a Gloam payment for this request and, if it's good, locks its transaction for the call. Call
 * finishGloamPayment afterwards with whether the API answered below 400.
 */
export async function redeemGloamPayment(opts: { gateway: Gateway; request: Request; path: string; payment: GloamPayment }): Promise<Redeemed> {
  const { payment } = opts;
  const db = await getDb();
  const fail = (status: number, error: string, message: string): Redeemed => ({ ok: false, status, error, message });

  const [q] = await db.select().from(gloamQuotes).where(eq(gloamQuotes.id, payment.quoteId)).limit(1);
  if (!q || q.gatewayId !== opts.gateway.id) return fail(402, "unknown_quote", "That quote isn't one this API issued. Call it again for a new 402.");
  if (q.method !== opts.request.method || q.path !== opts.path) {
    return fail(402, "quote_mismatch", "That quote was issued for a different request.");
  }
  const issuedAt = Math.floor(q.issuedAt.getTime() / 1000);
  if (!q.open && q.tx !== payment.txHash) return fail(402, "quote_closed", "That quote has been used or has expired. Call the API again for a new 402.");
  if (Date.now() / 1000 > issuedAt + QUOTE_TTL_S) return fail(402, "quote_expired", "That quote has expired. Call the API again for a new 402.");

  const [used] = await db.select().from(gloamPayments).where(eq(gloamPayments.tx, payment.txHash)).limit(1);
  if (used?.used) return fail(402, "payment_used", "That transaction has already paid for a call.");
  if (used && used.quoteId !== q.id) return fail(402, "payment_used", "That transaction belongs to another quote.");

  const check = await checkCashout(chain(), payment.txHash, { payTo: q.payTo, gross: BigInt(q.gross), price: BigInt(q.price), issuedAt });
  if (!check.ok) return fail(check.retry ? 503 : 402, check.retry ? "retry" : "payment_invalid", check.reason);

  // Claim the transaction in one statement, so two retries at once can't both run the call.
  const lockedUntil = new Date(Date.now() + LOCK_S * 1000);
  const claimed = await db
    .insert(gloamPayments)
    .values({ tx: payment.txHash, quoteId: q.id, lockedUntil })
    .onConflictDoUpdate({
      target: gloamPayments.tx,
      set: { lockedUntil },
      setWhere: and(eq(gloamPayments.used, false), eq(gloamPayments.quoteId, q.id), lt(gloamPayments.lockedUntil, sql`now()`)),
    })
    .returning({ tx: gloamPayments.tx });
  if (!claimed.length) return fail(409, "payment_in_use", "That transaction is already being used for a call. Retry in a moment.");
  return { ok: true, received: check.received };
}

/** Marks the payment used when the API answered below 400; otherwise releases it for a retry. */
export async function finishGloamPayment(payment: GloamPayment, succeeded: boolean) {
  const db = await getDb();
  if (succeeded) {
    await db.update(gloamPayments).set({ used: true }).where(eq(gloamPayments.tx, payment.txHash));
    await db.update(gloamQuotes).set({ open: false, tx: payment.txHash }).where(eq(gloamQuotes.id, payment.quoteId));
  } else {
    await db.delete(gloamPayments).where(and(eq(gloamPayments.tx, payment.txHash), eq(gloamPayments.used, false)));
  }
}

