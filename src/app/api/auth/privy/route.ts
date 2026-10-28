import { NextResponse, type NextRequest } from "next/server";
import { ownerFromPrivyToken, privyEnabled } from "@/lib/privy";
import { authEnabled, sessionCookie } from "@/lib/session";

// Exchanges a Privy access token (Authorization: Bearer …) for an Autonomo owner session.
export async function POST(request: NextRequest) {
  if (!authEnabled() || !privyEnabled()) return NextResponse.json({ error: "privy_disabled" }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 401 });

  const owner = await ownerFromPrivyToken(token);
  if (owner === null) return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  // The embedded wallet is created right after first login; the client retries.
  if (owner === "pending") return NextResponse.json({ error: "wallet_pending" }, { status: 409 });

  const res = NextResponse.json({ address: owner });
  res.cookies.set(sessionCookie(owner));
  return res;
}
