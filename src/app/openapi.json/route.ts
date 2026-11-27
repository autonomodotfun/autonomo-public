import { withUpdating } from "@/lib/api";
import { listAutonomoGateways } from "@/lib/directory/queries";
import { buildOpenApi } from "@/lib/gateway/openapi";

// /openapi.json: the official APIs as an OpenAPI document, where x402 catalogues such as x402scan and AgentCash
// look for a seller's routes and prices. Only listed, active gateways are in it, each at its live price
// (src/lib/gateway/openapi.ts). The 402 a gateway answers stays the final word on what a call costs.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun").replace(/\/+$/, "");

export const GET = withUpdating(async () => {
  const doc = buildOpenApi(await listAutonomoGateways(), { origin: SITE });
  return Response.json(doc, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
