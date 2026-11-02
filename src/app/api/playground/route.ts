import { createHash } from "node:crypto";
import { and, count, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { runAgent } from "@/lib/agent";
import type { PlaygroundEvent } from "@/lib/playground-events";

// Paying waits for on-chain settlement, and the first run may also send the one-time Permit2 approval.
export const maxDuration = 60;

// Agent Playground: streams the shared agent's steps (src/lib/agent.ts) to the page as NDJSON.
// Spending limits live in playground-pay.ts; these per-visitor limits only slow down abuse.
//
// Questions per minute: the real limit is a Vercel Firewall rate limit rule on /api/playground. The in-memory count
// below is per server instance, so it only covers local dev and anything the rule lets through.
// Paid questions per day: counted in the database, so every instance sees the same count.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const FREE_PAID_DAILY = 5;
const USED_UP = "You've used today's free paid questions. Come back tomorrow.";
const questions = new Map<string, number[]>();
const payments = new Map<string, number[]>();

function over(map: Map<string, number[]>, ip: string, windowMs: number, max: number, count = true) {
  const now = Date.now();
  const recent = (map.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (count) recent.push(now);
  map.set(ip, recent);
  if (map.size > 5000) map.clear();
  return recent.length > max;
}

/** Claims one of the visitor's free paid questions for today; returns a message to stop when they're used up. */
async function claimPaidQuestion(ip: string): Promise<string | null> {
  const visitor = createHash("sha256").update(ip).digest("hex");
  try {
    const db = await getDb();
    const t = schema.playgroundPayments;
    // Insert first, then count only the rows up to ours: two questions at once can't both take the last free one,
    // and the earlier one still gets it.
    const [row] = await db.insert(t).values({ visitor }).returning({ id: t.id });
    const [used] = await db
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.visitor, visitor), lte(t.id, row.id), gte(t.createdAt, new Date(Date.now() - DAY))));
    if ((used?.n ?? 0) <= FREE_PAID_DAILY) return null;
    await db.delete(t).where(eq(t.id, row.id));
    return USED_UP;
  } catch (err) {
    // The database is unreachable or the migration hasn't run: fall back to this instance's count.
    console.error("playground: daily limit falling back to memory", err);
    if (over(payments, ip, DAY, FREE_PAID_DAILY, false)) return USED_UP;
    over(payments, ip, DAY, FREE_PAID_DAILY);
    return null;
  }
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (over(questions, ip, MINUTE, 5)) return Response.json({ error: "Too many questions, try again in a minute." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 200) : "";
  if (question.length < 3) return Response.json({ error: "Ask a question first." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: PlaygroundEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      await runAgent(question, send, {
        mayPay: () => claimPaidQuestion(ip),
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
