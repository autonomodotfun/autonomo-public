import { askAgentWithLimits } from "@/lib/agent-ai";
import type { AgentEvent } from "@/lib/agent-events";
import { webVisitorId } from "@/lib/agent-limits";

// One question can take several model turns and on-chain payments, and the first run may also send the one-time
// Permit2 approval.
export const maxDuration = 120;

// Agent Playground: streams the agent's progress (src/lib/agent-ai.ts) to the page as NDJSON. Spending and daily
// limits live in the agent.
//
// Questions per minute: the real limit is a Vercel Firewall rate limit rule on /api/playground. The in-memory count
// below is per server instance, so it only covers local dev and anything the rule lets through.

const MINUTE = 60_000;
const MAX_QUESTION_CHARS = 500;
const PING_MS = 10_000;
const recent = new Map<string, number[]>();

function tooFast(visitor: string) {
  const now = Date.now();
  const hits = (recent.get(visitor) ?? []).filter((t) => now - t < MINUTE);
  hits.push(now);
  recent.set(visitor, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 5;
}

export async function POST(request: Request) {
  const visitor = webVisitorId(request.headers);
  if (tooFast(visitor)) return Response.json({ error: "Too many questions, try again in a minute." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { question?: unknown; conversationId?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
  if (question.length < 3) return Response.json({ error: "Ask a question first." }, { status: 400 });
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      // If the visitor leaves, the agent still finishes what it paid for and records it.
      const send = (e: AgentEvent) => {
        if (open) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      const keepAlive = setInterval(() => send({ type: "ping" }), PING_MS);
      try {
        await askAgentWithLimits("web", visitor, question, send, { conversationId });
      } finally {
        clearInterval(keepAlive);
      }
      if (open) controller.close();
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
