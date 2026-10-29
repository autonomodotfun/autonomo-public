import { runAgent } from "@/lib/agent";
import type { PlaygroundEvent } from "@/lib/playground-events";

// Paying waits for on-chain settlement, and the first run may also send the one-time Permit2 approval.
export const maxDuration = 60;

// Agent Playground: streams the shared agent's steps (src/lib/agent.ts) to the page as NDJSON.
// Spending limits live in playground-pay.ts; these per-visitor limits only slow down abuse.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
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
        mayPay: () => {
          if (over(payments, ip, DAY, 5, false)) return "You've used today's free paid questions. Come back tomorrow.";
          over(payments, ip, DAY, 5);
          return null;
        },
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
