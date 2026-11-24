import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Wallet sessions for gateway owners. Sign-In with Ethereum proves the address; we then keep it in an
// HMAC-signed cookie (SESSION_SECRET). Without SESSION_SECRET, sign-in is disabled.

export const SESSION_COOKIE = "autonomo_session";
export const NONCE_COOKIE = "autonomo_siwe_nonce";
const SESSION_TTL_S = 7 * 24 * 3600;
export const NONCE_TTL_S = 10 * 60;

export function authEnabled() {
  return Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
}

function sign(payload: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
}

export function seal(data: Record<string, unknown>, ttlSeconds: number) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function unseal<T>(token: string | undefined): (T & { exp: number }) | null {
  if (!token || !authEnabled()) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as T & { exp: number };
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export function sessionCookie(address: string) {
  return { name: SESSION_COOKIE, value: seal({ a: address.toLowerCase() }, SESSION_TTL_S), ...cookieOptions(SESSION_TTL_S) };
}

/** The signed-in owner's lowercased address, or null. */
export async function currentOwner(): Promise<string | null> {
  return unseal<{ a: string }>((await cookies()).get(SESSION_COOKIE)?.value)?.a ?? null;
}
