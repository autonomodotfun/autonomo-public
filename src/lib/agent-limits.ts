import "server-only";
import { createHmac } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AgentReceipt, AgentUsage } from "@/lib/agent-events";
import { freeDaily } from "@/lib/telegram";

// Daily limits on the AI agent, kept in the database so they hold across server instances and restarts. Every
// question costs model usage whether or not it pays for an API, so a question is counted before the model runs.
// Days are UTC.
//
// Env:
//   SESSION_SECRET       Keys the hash of visitor ids. Without it the agent takes no questions.
//   AGENT_FREE_DAILY     Optional: free questions per website visitor per day (default 5).
//   AGENT_SITE_DAILY     Optional: questions per day for everyone together, the ceiling on model costs (default 500).

export type AgentSurface = "web" | "telegram";

const KEEP_COUNTERS_DAYS = 7;

function envLimit(name: string, fallback: number) {
  const n = Number(process.env[name] ?? fallback);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const webFreeDaily = () => envLimit("AGENT_FREE_DAILY", 5);

const visitorLimit = (surface: AgentSurface) => (surface === "telegram" ? freeDaily() : webFreeDaily());

/** The visitor's IP from the request. One IPv6 network counts as one visitor, since each home can use millions of addresses. */
export function webVisitorId(headers: Headers) {
  const ip = headers.get("x-forwarded-for")?.split(",")[0].trim().toLowerCase() || "local";
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const start = head ? head.split(":") : [];
  const end = tail ? tail.split(":") : [];
  const full = [...start, ...Array(Math.max(0, 8 - start.length - end.length)).fill("0"), ...end];
  return `${full.slice(0, 4).map((part) => part.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** A stable pseudonym, so we can count returning visitors without storing who they are. */
function subjectFor(surface: AgentSurface, visitorId: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(`agent:${surface}:${visitorId}`).digest("base64url").slice(0, 32);
}

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Adds one to a counter unless it's already at the limit. Returns the new count, or null when it was full. */
async function take(key: string, day: string, limit: number) {
  if (limit <= 0) return null;
  const db = await getDb();
  const t = schema.agentLimits;
  const [row] = await db
    .insert(t)
    .values({ key, day, count: 1 })
    .onConflictDoUpdate({ target: t.key, set: { count: sql`${t.count} + 1` }, where: sql`${t.count} < ${limit}` })
    .returning({ count: t.count });
  return row?.count ?? null;
}

export type Allowance = { ok: true; subject: string; left: number } | { ok: false; detail: string };

/** Counts one question against the visitor's limit and the site-wide one, or says why it can't be asked. */
export async function reserveQuestion(surface: AgentSurface, visitorId: string): Promise<Allowance> {
  const subject = subjectFor(surface, visitorId);
  const day = utcDay();
  const limit = visitorLimit(surface);

  const used = await take(`${surface}:${subject}:${day}`, day, limit);
  if (used === null) return { ok: false, detail: `You've used today's ${limit} free questions. Come back tomorrow.` };

  const siteCount = await take(`site:${day}`, day, envLimit("AGENT_SITE_DAILY", 500));
  if (siteCount === null) return { ok: false, detail: "The agent has answered all it can for today. Come back tomorrow." };

  // The first question of the day clears out old counters.
  if (siteCount === 1) {
    const db = await getDb();
    await db
      .delete(schema.agentLimits)
      .where(lt(schema.agentLimits.day, utcDay(Date.now() - KEEP_COUNTERS_DAYS * 24 * 3600 * 1000)))
      .catch((e) => console.error("couldn't clear old agent counters", e));
  }
  return { ok: true, subject, left: limit - used };
}

export async function recordQuestion(q: { surface: AgentSurface; subject: string; outcome: "answer" | "fail"; usage: AgentUsage | null; receipts: AgentReceipt[] }) {
  const db = await getDb();
  await db.insert(schema.agentQuestions).values({
    surface: q.surface,
    subject: q.subject,
    outcome: q.outcome,
    model: q.usage?.model ?? null,
    inputTokens: q.usage?.inputTokens ?? 0,
    cachedTokens: q.usage?.cachedTokens ?? 0,
    cacheWriteTokens: q.usage?.cacheWriteTokens ?? 0,
    outputTokens: q.usage?.outputTokens ?? 0,
    receipts: q.receipts.map(({ api, amount, tx }) => ({ api, amount, tx })),
  });
}
