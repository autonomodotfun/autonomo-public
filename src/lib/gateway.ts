import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb, schema } from "@/db";
import type { Gateway } from "@/db/schema";
import { offers } from "@/lib/pro";

const { gateways, gatewayCalls } = schema;

export const RESERVED_SLUGS = new Set(["new", "api", "admin", "dashboard", "docs", "pro", "x", "www", "autonomo"]);
const MAX_REQUEST_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const UPSTREAM_TIMEOUT_MS = 25_000;

// ---------- upstream secret encryption (AES-256-GCM, key derived from GATEWAY_SECRET_KEY) ----------

export function secretsEnabled() {
  return (process.env.GATEWAY_SECRET_KEY?.length ?? 0) >= 32;
}

function key() {
  return createHash("sha256").update(process.env.GATEWAY_SECRET_KEY!).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function decryptSecret(sealed: string) {
  const [, iv, tag, data] = sealed.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// ---------- SSRF protection ----------

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const)
  blocked.addSubnet(net, prefix, "ipv6");

function isPrivate(ip: string) {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  return blocked.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

// Local development may point a gateway at a server on this machine.
const allowPrivate = process.env.NODE_ENV === "development" && process.env.GATEWAY_ALLOW_PRIVATE_UPSTREAMS === "1";

/** Validates an upstream base URL: https, no credentials, and a public address. */
export async function checkUpstream(raw: string): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Enter a full URL, like https://api.example.com" };
  }
  if (url.username || url.password) return { ok: false, error: "Don't put credentials in the URL; use the auth header." };
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    return { ok: false, error: "The upstream must use https." };
  }
  if (url.search || url.hash) return { ok: false, error: "Use a base URL without a query string." };
  if (!allowPrivate) {
    try {
      const addrs = await lookup(url.hostname, { all: true, verbatim: true });
      if (!addrs.length || addrs.some((a) => isPrivate(a.address))) {
        return { ok: false, error: "That host resolves to a private address." };
      }
    } catch {
      return { ok: false, error: "That host doesn't resolve." };
    }
  }
  return { ok: true, url };
}

// ---------- forwarding ----------

const FORWARD_REQUEST_HEADERS = ["accept", "accept-language", "content-type", "user-agent"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-language", "etag", "last-modified"];

async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

/** Calls the gateway's upstream for one request. `path` is everything after /x/<slug>. */
export async function forward(g: Gateway, request: Request, path: string): Promise<Response> {
  const check = await checkUpstream(g.upstreamUrl);
  if (!check.ok) return problem(502, "upstream_blocked", check.error);

  const base = check.url.href.replace(/\/+$/, "");
  const target = new URL(base + (path.startsWith("/") ? path : `/${path}`) + new URL(request.url).search);
  // Dot segments (including encoded %2e%2e) must not climb out of the owner's base path.
  const basePath = check.url.pathname.replace(/\/+$/, "");
  if (target.host !== check.url.host || (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`))) {
    return problem(400, "bad_path", "That path is outside this API.");
  }

  const headers = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (g.upstreamAuthHeader && g.upstreamAuthSecret && secretsEnabled()) {
    headers.set(g.upstreamAuthHeader, decryptSecret(g.upstreamAuthSecret));
  }

  let body: Uint8Array | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const read = await readCapped(request.body, MAX_REQUEST_BYTES);
    if (!read) return problem(413, "request_too_large", "Request bodies are limited to 1 MB.");
    body = read;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return problem(504, timeout ? "upstream_timeout" : "upstream_unreachable", timeout ? "The API took too long to respond." : "The API could not be reached.");
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return problem(502, "upstream_redirect", "The API answered with a redirect, which gateways don't follow.");
  }
  const data = await readCapped(upstream.body, MAX_RESPONSE_BYTES);
  if (!data) return problem(502, "response_too_large", "The API response is larger than 5 MB.");

  const out = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(data as BodyInit, { status: upstream.status, headers: out });
}

// ---------- queries ----------

export function gatewayOffers(g: Pick<Gateway, "priceUsd" | "acceptUsdg" | "autonomoAmount">) {
  return offers({ priceUsd: String(Number(g.priceUsd)), acceptUsdg: g.acceptUsdg, autonomoAmount: g.autonomoAmount });
}

export async function getGateway(slug: string) {
  const db = await getDb();
  const [g] = await db.select().from(gateways).where(eq(gateways.slug, slug)).limit(1);
  return g ?? null;
}

export async function getOwnedGateway(slug: string, owner: string) {
  await connection();
  const db = await getDb();
  const [g] = await db
    .select()
    .from(gateways)
    .where(and(eq(gateways.slug, slug), eq(gateways.owner, owner)))
    .limit(1);
  return g ?? null;
}

export async function recordCall(row: typeof gatewayCalls.$inferInsert) {
  const db = await getDb();
  await db.insert(gatewayCalls).values(row);
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000);

// Revenue sums per rail in atomic units (as text, to keep precision), over settled calls.
const revenueCols = {
  calls: sql<number>`count(*)::int`,
  settled: sql<number>`count(*) filter (where ${gatewayCalls.settled})::int`,
  usdg: sql<string>`coalesce(sum(${gatewayCalls.amount}::numeric) filter (where ${gatewayCalls.settled} and ${gatewayCalls.rail} = 'usdg'), 0)::text`,
  autonomo: sql<string>`coalesce(sum(${gatewayCalls.amount}::numeric) filter (where ${gatewayCalls.settled} and ${gatewayCalls.rail} = 'autonomo'), 0)::text`,
  usdc: sql<string>`coalesce(sum(${gatewayCalls.amount}::numeric) filter (where ${gatewayCalls.settled} and ${gatewayCalls.rail} = 'usdc'), 0)::text`,
};

export type RevenueTotals = { calls: number; settled: number; usdg: string; autonomo: string; usdc: string };

export async function listOwnerGateways(owner: string) {
  await connection();
  const db = await getDb();
  const rows = await db.select().from(gateways).where(eq(gateways.owner, owner)).orderBy(desc(gateways.createdAt));
  const totals = rows.length
    ? await db
        .select({ gatewayId: gatewayCalls.gatewayId, ...revenueCols })
        .from(gatewayCalls)
        .innerJoin(gateways, eq(gatewayCalls.gatewayId, gateways.id))
        .where(and(eq(gateways.owner, owner), gte(gatewayCalls.createdAt, since(30))))
        .groupBy(gatewayCalls.gatewayId)
    : [];
  const byId = new Map(totals.map((t) => [t.gatewayId, t]));
  return rows.map((g) => ({ gateway: g, last30: byId.get(g.id) ?? null }));
}

export async function gatewayStats(gatewayId: number) {
  const db = await getDb();
  const [allTime, last30, daily, recent] = await Promise.all([
    db.select(revenueCols).from(gatewayCalls).where(eq(gatewayCalls.gatewayId, gatewayId)),
    db.select(revenueCols).from(gatewayCalls).where(and(eq(gatewayCalls.gatewayId, gatewayId), gte(gatewayCalls.createdAt, since(30)))),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${gatewayCalls.createdAt}), 'YYYY-MM-DD')`,
        calls: sql<number>`count(*)::int`,
        settled: sql<number>`count(*) filter (where ${gatewayCalls.settled})::int`,
      })
      .from(gatewayCalls)
      .where(and(eq(gatewayCalls.gatewayId, gatewayId), gte(gatewayCalls.createdAt, since(14))))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select()
      .from(gatewayCalls)
      .where(eq(gatewayCalls.gatewayId, gatewayId))
      .orderBy(desc(gatewayCalls.createdAt))
      .limit(25),
  ]);
  return { allTime: allTime[0] as RevenueTotals, last30: last30[0] as RevenueTotals, daily, recent };
}
