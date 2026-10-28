import { NextResponse, type NextRequest } from "next/server";
import { isAddress, isHex, verifyMessage } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { authEnabled, NONCE_COOKIE, sessionCookie, unseal } from "@/lib/session";

// Verifies a signed SIWE message and starts a session for that wallet (EOA signatures).
export async function POST(request: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ error: "auth_disabled" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.slice(0, 2000) : "";
  const signature = body?.signature;
  if (!message || !isHex(signature)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const nonce = unseal<{ n: string }>(request.cookies.get(NONCE_COOKIE)?.value)?.n;
  const parsed = parseSiweMessage(message);
  const valid =
    nonce &&
    parsed.address &&
    isAddress(parsed.address) &&
    validateSiweMessage({ message: parsed, domain: request.nextUrl.host, nonce }) &&
    (await verifyMessage({ address: parsed.address, message, signature }).catch(() => false));
  if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  const res = NextResponse.json({ address: parsed.address!.toLowerCase() });
  res.cookies.set(sessionCookie(parsed.address!));
  res.cookies.delete(NONCE_COOKIE);
  return res;
}
