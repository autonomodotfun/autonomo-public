import { after, NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import type { Gateway } from "@/db/schema";
import { updating } from "@/lib/api";
import { forward, gatewayOffers, getGateway, recordCall } from "@/lib/gateway";
import { acceptsFor, railForAsset, x402Server } from "@/lib/pro";

// Hosted x402 gateway: autonomo.fun/x/<slug>/<path> -> <upstream>/<path>, paid per call.
// Payments go to the owner's wallet; the upstream is only called after the payment verifies, and the payment
// only settles when the upstream answers below 400.

// Upstream calls may take up to 25 s (see forward()); leave headroom for payment verification and settlement.
export const maxDuration = 60;

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "PAYMENT-SIGNATURE, Content-Type, Accept",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
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

function paidHandler(g: Gateway) {
  const key = `${g.id}:${g.updatedAt.getTime()}`;
  let fn = wrappers.get(key);
  if (!fn) {
    const prefix = `/x/${g.slug}`;
    fn = withX402(
      async (req: NextRequest) => {
        const res = await forward(g, req, req.nextUrl.pathname.slice(prefix.length) || "/");
        return new NextResponse(res.body, { status: res.status, headers: res.headers });
      },
      {
        accepts: acceptsFor(g.owner, gatewayOffers(g)),
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

  const started = Date.now();
  const res = await paidHandler(g)(request);

  // Record attempts that carried a payment, after the response is sent.
  const payment = decodeHeader(request.headers.get("payment-signature"));
  if (payment) {
    const settlement = decodeHeader(res.headers.get("payment-response"));
    const accepted = payment.accepted ?? {};
    const auth = payment.payload?.authorization ?? payment.payload?.permit2Authorization ?? {};
    after(() =>
      recordCall({
        gatewayId: g.id,
        method: request.method,
        path: request.nextUrl.pathname.slice(`/x/${slug}`.length).slice(0, 300) || "/",
        status: res.status,
        latencyMs: Date.now() - started,
        rail: railForAsset(accepted.asset),
        asset: typeof accepted.asset === "string" ? accepted.asset : null,
        amount: typeof accepted.amount === "string" ? accepted.amount : null,
        payer: (settlement?.payer ?? auth.from ?? null)?.toString().toLowerCase() ?? null,
        settled: settlement?.success === true,
        tx: typeof settlement?.transaction === "string" ? settlement.transaction : null,
      }).catch((e) => console.error("gateway call log failed", e)),
    );
  }
  return withHeaders(res, slug);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

export function OPTIONS() {
  return withHeaders(new Response(null, { status: 204 }));
}
