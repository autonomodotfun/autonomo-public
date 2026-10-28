import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { parseEndpointQuery, searchEndpoints } from "@/lib/queries";
import { proAccepts, proConfig, proServer } from "@/lib/pro";

// Paid responses must never be cached by the CDN (the cache key ignores the payment header),
// and browser agents need to read and send the x402 headers across origins.
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "PAYMENT-SIGNATURE, Content-Type",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
  "Cache-Control": "private, no-store",
};

function withHeaders(res: NextResponse) {
  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
  return res;
}

async function handler(request: NextRequest) {
  const query = parseEndpointQuery(request.nextUrl.searchParams);
  const { rows, total, page, limit, sort } = await searchEndpoints(query);
  return NextResponse.json({
    data: rows.map((e) => ({ ...e, priceUsd: e.priceUsd === null ? null : Number(e.priceUsd) })),
    meta: { total, page, limit, sort, pages: Math.ceil(total / limit) },
  });
}

const paid = proConfig
  ? withX402(
      handler,
      {
        accepts: proAccepts(proConfig),
        description: "Autonomo pro: endpoint-level search across the x402 catalog",
        mimeType: "application/json",
      },
      proServer(proConfig),
    )
  : null;

export async function GET(request: NextRequest) {
  if (!paid) {
    return withHeaders(
      NextResponse.json(
        { error: "paid_tier_unavailable", message: "The paid API tier is not enabled yet. See /docs#pro." },
        { status: 503 },
      ),
    );
  }
  return withHeaders(await paid(request));
}

export function OPTIONS() {
  return withHeaders(new NextResponse(null, { status: 204 }));
}
