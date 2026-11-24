import { NextResponse, type NextRequest } from "next/server";
import { updating } from "@/lib/api";
import { x402Server } from "@/lib/payments/payments";
import { routeDeps, routerEnabled } from "@/lib/router/router-gateway";
import { handleRoute } from "@/lib/router/router-http";

// The router: autonomo.fun/route/<capability>?<inputs>. An agent asks for a service, such as the price of a token,
// and Autonomo picks the API that serves it. The answer to an unpaid request is the chosen API's own 402 and a route
// id; the paid request goes to that API, and the payment only settles once its answer is checked (src/lib/router/router.ts).
// Off unless ROUTER_ENABLED=1.

// An API may take up to 25 s; leave headroom for payment verification and settlement, as on /x/<slug>.
export const maxDuration = 60;

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "PAYMENT-SIGNATURE, X-PAYMENT, X-Autonomo-Route-Id, Content-Type, Accept",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, X-Autonomo-Route-Id, X-Autonomo-Routed-To, X-Autonomo-Bonded",
  "Cache-Control": "private, no-store",
};

function withHeaders(res: Response) {
  const out = new NextResponse(res.body, { status: res.status, headers: res.headers });
  for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
  return out;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ capability: string }> }) {
  if (!routerEnabled()) return withHeaders(Response.json({ error: "not_found" }, { status: 404 }));
  if (!x402Server()) {
    return withHeaders(Response.json({ error: "payments_unavailable", message: "Payments are not available right now." }, { status: 503 }));
  }
  const { capability } = await ctx.params;
  try {
    // Vercel sets x-forwarded-for itself, so the first address in it is the caller's.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
    return withHeaders(await handleRoute(request, capability, await routeDeps(), ip));
  } catch (e) {
    // The database, the chain or the payment service couldn't be reached. Nobody is charged: a payment only settles
    // after a checked answer.
    console.error("route failed", e);
    return withHeaders(updating());
  }
}

export function OPTIONS() {
  return withHeaders(new Response(null, { status: 204 }));
}
