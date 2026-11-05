import { after, NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import type { Gateway } from "@/db/schema";
import { updating } from "@/lib/api";
import { BURN_BPS, noteBurnCall, payToFor } from "@/lib/burn";
import { forward, gatewayOffers, getGateway, recordCall, payeeOf } from "@/lib/gateway";
import { finishGloamPayment, gloamEnabledFor, gloamPaymentOf, issueGloamQuote, redeemGloamPayment } from "@/lib/gloam";
import { GLOAM_USDG, GLOAM_VAULT } from "@/lib/gloam-check";
import { acceptsFor, railForAsset, x402Server } from "@/lib/payments";

// Hosted x402 gateway: autonomo.fun/x/<slug>/<path> -> <upstream>/<path>, paid per call.
// Payments go to the owner's wallet, or to its burn splitter when burning is on (src/lib/burn.ts); the upstream is
// only called after the payment verifies, and the payment only settles when the upstream answers below 400.
// Gateways listed in GLOAM_CASHOUT_GATEWAYS also offer a Gloam cash-out (src/lib/gloam.ts), where the payment lands
// before the call; its transaction is only marked used once the upstream answers below 400.

// Upstream calls may take up to 25 s (see forward()); leave headroom for payment verification and settlement.
export const maxDuration = 60;

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Accept",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE",
  "Cache-Control": "private, no-store",
};

function withHeaders(res: Response, slug?: string) {
  const out = new NextResponse(res.body, { status: res.status, headers: res.headers });
  for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
  if (slug) out.headers.set("X-Autonomo-Gateway", slug);
  return out;
}

function decodeHeader(value: string | null): Record<string, any> | null {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// One paid wrapper per gateway version, so edits take effect immediately.
const wrappers = new Map<string, (req: NextRequest) => Promise<NextResponse>>();

function paidHandler(g: Gateway, payTo: string) {
  const key = `${g.id}:${g.updatedAt.getTime()}:${payTo}`;
  let fn = wrappers.get(key);
  if (!fn) {
    const prefix = `/x/${g.slug}`;
    fn = withX402(
      async (req: NextRequest) => {
        const res = await forward(g, req, req.nextUrl.pathname.slice(prefix.length) || "/");
        return new NextResponse(res.body, { status: res.status, headers: res.headers });
      },
      {
        accepts: acceptsFor(payTo, gatewayOffers(g)),
        description: g.description || g.name,
        mimeType: "application/json",
      },
      x402Server()!,
    );
    wrappers.set(key, fn);
  }
  return fn;
}

async function handle(request: NextRequest, ctx: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug } = await ctx.params;
  let g: Awaited<ReturnType<typeof getGateway>>;
  try {
    g = await getGateway(slug);
  } catch (e) {
    // Database briefly unavailable: a clear, retryable 503 for agents instead of a 500. Nobody is charged.
    console.error(e);
    return withHeaders(updating(), slug);
  }
  if (!g) return withHeaders(Response.json({ error: "not_found" }, { status: 404 }));
  if (g.status !== "active") {
    return withHeaders(Response.json({ error: "gateway_paused", message: "This API is paused by its owner." }, { status: 503 }), slug);
  }
  if (!x402Server() || gatewayOffers(g).length === 0) {
    return withHeaders(Response.json({ error: "payments_unavailable", message: "Payments are not available for this API right now." }, { status: 503 }), slug);
  }

  let payTo: string;
  try {
    payTo = await payToFor(payeeOf(g));
  } catch (e) {
    // The burn splitter's address couldn't be read from the chain. Nobody is charged.
    console.error("burn splitter lookup failed", e);
    return withHeaders(updating(), slug);
  }

  const started = Date.now();
  const path = request.nextUrl.pathname.slice(`/x/${slug}`.length) || "/";
  const gloam = gloamEnabledFor(slug) && g.acceptUsdg ? gloamPaymentOf(request) : null;
  if (gloam) return withHeaders(await gloamCall(request, g, payTo, path, gloam, started), slug);

  let res = await paidHandler(g, payTo)(request);
  if (res.status === 402 && gloamEnabledFor(slug) && g.acceptUsdg) res = await withGloamOption(res, request, g, payTo, path);

  // Record attempts that carried a payment, after the response is sent.
  const payment = decodeHeader(request.headers.get("payment-signature"));
  if (payment) {
    const settlement = decodeHeader(res.headers.get("payment-response"));
    const accepted = payment.accepted ?? {};
    const auth = payment.payload?.authorization ?? payment.payload?.permit2Authorization ?? {};
    const settled = settlement?.success === true;
    const burnBps = payTo === payeeOf(g) ? 0 : BURN_BPS;
    after(async () => {
      await recordCall({
        gatewayId: g.id,
        method: request.method,
        path: path.slice(0, 300),
        status: res.status,
        latencyMs: Date.now() - started,
        rail: railForAsset(accepted.asset),
        asset: typeof accepted.asset === "string" ? accepted.asset : null,
        amount: typeof accepted.amount === "string" ? accepted.amount : null,
        burnBps,
        payer: (settlement?.payer ?? auth.from ?? null)?.toString().toLowerCase() ?? null,
        settled,
        tx: typeof settlement?.transaction === "string" ? settlement.transaction : null,
      }).catch((e) => console.error("gateway call log failed", e));
      if (settled && burnBps > 0) await noteBurnCall(payeeOf(g)).catch((e) => console.error("burn flush failed", e));
    });
  }
  return withHeaders(res, slug);
}

/** Adds the Gloam cash-out option to an x402 402 answer. If no quote can be issued, the answer goes out as it was. */
async function withGloamOption(res: NextResponse, request: NextRequest, g: Gateway, payTo: string, path: string) {
  const required = decodeHeader(res.headers.get("payment-required"));
  const usdg = gatewayOffers(g).find((o) => o.kind === "usdg");
  if (!required || !Array.isArray(required.accepts) || !usdg) return res;
  let accept;
  try {
    accept = await issueGloamQuote({ gateway: g, request, path: path + request.nextUrl.search, payTo, price: BigInt(usdg.atomic) });
  } catch (e) {
    console.error("gloam quote failed", e);
    return res;
  }
  if (!accept) return res;
  required.accepts.push(accept);
  const out = new NextResponse(res.body, { status: res.status, headers: res.headers });
  out.headers.set("payment-required", Buffer.from(JSON.stringify(required)).toString("base64"));
  return out;
}

/** Serves a call paid with a Gloam cash-out. */
async function gloamCall(
  request: NextRequest,
  g: Gateway,
  payTo: string,
  path: string,
  payment: NonNullable<ReturnType<typeof gloamPaymentOf>>,
  started: number,
) {
  let redeemed: Awaited<ReturnType<typeof redeemGloamPayment>>;
  try {
    redeemed = await redeemGloamPayment({ gateway: g, request, path: path + request.nextUrl.search, payment });
  } catch (e) {
    console.error("gloam redeem failed", e);
    return updating();
  }
  if (!redeemed.ok) {
    const res = Response.json({ error: redeemed.error, message: redeemed.message }, { status: redeemed.status });
    if (redeemed.status === 503 || redeemed.status === 409) res.headers.set("Retry-After", "5");
    return res;
  }

  const upstream = await forward(g, request, path);
  const succeeded = upstream.status < 400;
  try {
    await finishGloamPayment(payment, succeeded);
  } catch (e) {
    // The lock expires on its own, so a retry still works; only a success might go unrecorded as used.
    console.error("gloam finish failed", e);
  }

  const burnBps = payTo === payeeOf(g) ? 0 : BURN_BPS;
  after(async () => {
    await recordCall({
      gatewayId: g.id,
      method: request.method,
      path: path.slice(0, 300),
      status: upstream.status,
      latencyMs: Date.now() - started,
      rail: "usdg",
      asset: GLOAM_USDG,
      amount: redeemed.received.toString(),
      burnBps,
      // The cash-out comes from Gloam's vault, so that is the only payer on chain.
      payer: GLOAM_VAULT.toLowerCase(),
      settled: succeeded,
      tx: payment.txHash,
    }).catch((e) => console.error("gateway call log failed", e));
    if (succeeded && burnBps > 0) await noteBurnCall(payeeOf(g)).catch((e) => console.error("burn flush failed", e));
  });

  const out = new NextResponse(upstream.body, { status: upstream.status, headers: upstream.headers });
  out.headers.set(
    "X-PAYMENT-RESPONSE",
    Buffer.from(JSON.stringify({ success: succeeded, scheme: "gloam-cashout", transaction: payment.txHash, network: "eip155:4663" })).toString("base64"),
  );
  return out;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

export function OPTIONS() {
  return withHeaders(new Response(null, { status: 204 }));
}
