import "server-only";
import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { and, eq, gte, sql } from "drizzle-orm";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, maxUint256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDb, schema } from "@/db";
import { TOKEN } from "@/lib/constants";

// The Agent Playground's wallet: pays Autonomo gateways in $AUTONOMO on behalf of visitors.
//
// Env:
//   PLAYGROUND_AGENT_PRIVATE_KEY   A dedicated wallet holding only $AUTONOMO for the playground (plus a little ETH
//                                  on Robinhood Chain for the one-time Permit2 approval). Without it, paying is off.
//   PLAYGROUND_DAILY_AUTONOMO      Optional: whole $AUTONOMO the agent may spend per rolling 24 h (default 20000).
//   ROBINHOOD_RPC_URL              Optional: a private RPC, instead of the public one. Server-side only: it holds a key.
//
// Limits are enforced here, never by the model or the page: only $AUTONOMO, at most 5,000 per payment, only
// this site's /x/ gateways, and a daily budget counted from the gateway payment log.

const MAX_PER_PAYMENT = 5_000n * 10n ** 18n;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const EXPLORER = "https://robinhoodchain.blockscout.com";

const robinhood = defineChain({
  id: TOKEN.chainId,
  name: TOKEN.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [TOKEN.rpcUrl] } },
});

const rpcUrl = () => process.env.ROBINHOOD_RPC_URL?.trim() || TOKEN.rpcUrl;

function agentAccount() {
  const key = process.env.PLAYGROUND_AGENT_PRIVATE_KEY?.trim();
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as Hex) : null;
}

export function playgroundPaymentsEnabled() {
  return agentAccount() !== null;
}

function dailyBudget() {
  const n = Number(process.env.PLAYGROUND_DAILY_AUTONOMO);
  return BigInt(Number.isInteger(n) && n > 0 ? n : 20_000) * 10n ** 18n;
}

/** $AUTONOMO the agent spent in the last 24 hours, from settled gateway payments. */
async function spentToday(payer: string) {
  const db = await getDb();
  const { gatewayCalls } = schema;
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${gatewayCalls.amount}::numeric), 0)::text` })
    .from(gatewayCalls)
    .where(
      and(
        eq(gatewayCalls.payer, payer.toLowerCase()),
        eq(gatewayCalls.settled, true),
        eq(sql`lower(${gatewayCalls.asset})`, TOKEN.address.toLowerCase()),
        gte(gatewayCalls.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
      ),
    );
  return BigInt(row?.total.split(".")[0] ?? "0");
}

/** Only gateways on this site may be paid. */
function payable(url: URL) {
  const site = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://autonomo.fun");
  return url.protocol === "https:" && url.host === site.host && url.pathname.startsWith("/x/");
}

export type PayResult =
  | { ok: true; amount: string; data: unknown; tx: string | null; explorer: string | null }
  | { ok: false; error: string; resting?: boolean };

/** Pays for one call to an Autonomo gateway in $AUTONOMO and returns what it bought. */
export async function payAndCall(rawUrl: string, amountWhole: string): Promise<PayResult> {
  const account = agentAccount();
  if (!account) return { ok: false, error: "The agent's wallet isn't live yet." };
  const url = new URL(rawUrl);
  if (!payable(url)) return { ok: false, error: "The agent only pays Autonomo gateways." };

  const amount = BigInt(amountWhole) * 10n ** 18n;
  if (amount <= 0n || amount > MAX_PER_PAYMENT) return { ok: false, error: "That price is above the agent's limit." };
  if ((await spentToday(account.address)) + amount > dailyBudget()) {
    return { ok: false, resting: true, error: "The agent spent today's budget. It's resting until tomorrow." };
  }

  const pub = createPublicClient({ chain: robinhood, transport: http(rpcUrl()) });
  const balance = await pub.readContract({ address: TOKEN.address as Hex, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance < amount) return { ok: false, resting: true, error: "The agent's wallet is out of $AUTONOMO for now." };

  // $AUTONOMO pays through Permit2: one on-chain approval, then every payment is just a signature.
  const allowance = await pub.readContract({ address: TOKEN.address as Hex, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
  if (allowance < amount) {
    const wallet = createWalletClient({ account, chain: robinhood, transport: http(rpcUrl()) });
    const hash = await wallet.writeContract({ address: TOKEN.address as Hex, abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
    await pub.waitForTransactionReceipt({ hash });
  }

  const client = x402Client.fromConfig({
    schemes: [{ network: TOKEN.network, client: new ExactEvmScheme(toClientEvmSigner(account, pub), { rpcUrl: rpcUrl() }) }],
    spendControls: {
      allowedAssets: [{ network: TOKEN.network, asset: TOKEN.address, maxAmountPerPayment: amount.toString() }],
      maxAmountPerPayment: false,
    },
    paymentRequirementsSelector: (_v, reqs) => reqs.find((r) => r.asset.toLowerCase() === TOKEN.address.toLowerCase()) ?? reqs[0],
  });

  const res = await wrapFetchWithPayment(fetch, client)(url, { signal: AbortSignal.timeout(45_000) });
  const settlement = decode(res.headers.get("payment-response"));
  if (res.status !== 200) {
    // Not awaited: cancelling can wait on a copy of the body that nobody reads, which froze failed payments.
    void res.body?.cancel().catch(() => {});
    return { ok: false, error: `The API answered ${res.status}, so no payment was taken.` };
  }
  const text = (await res.text()).slice(0, 50_000);
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Plain-text APIs are fine.
  }
  const tx = typeof settlement?.transaction === "string" ? settlement.transaction : null;
  return { ok: true, amount: formatUnits(amount, 18), data, tx, explorer: tx ? `${EXPLORER}/tx/${tx}` : null };
}

function decode(h: string | null) {
  if (!h) return null;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch {
    return null;
  }
}
