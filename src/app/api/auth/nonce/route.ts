import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { authEnabled, cookieOptions, NONCE_COOKIE, NONCE_TTL_S, seal } from "@/lib/session";

// Issues a one-time nonce for Sign-In with Ethereum, bound to this browser by a signed cookie.
export async function GET() {
  if (!authEnabled()) return NextResponse.json({ error: "auth_disabled" }, { status: 503 });
  const nonce = generateSiweNonce();
  const res = NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(NONCE_COOKIE, seal({ n: nonce }, NONCE_TTL_S), cookieOptions(NONCE_TTL_S));
  return res;
}
