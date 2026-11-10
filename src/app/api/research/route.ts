import { isAddress } from "viem";
import { researchFreeDaily, reserveReport, returnReport, webVisitorId } from "@/lib/agent-limits";
import { playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { researchToken, type ResearchEvent } from "@/lib/research";
import { researchSampleMode, sampleDeps } from "@/lib/research-sample";

// Up to four payments one after another, a first-time Permit2 approval at most, and the written summary.
export const maxDuration = 120;

// The research agent behind the Playground's Research mode: one free token report per request, paid by the
// Playground's wallet, streamed to the page as NDJSON (see ResearchEvent in src/lib/research.ts).
// Like /api/playground, the real per-minute limit is a Vercel Firewall rule; this in-memory count covers local dev.

const MINUTE = 60_000;
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
  if (tooFast(visitor)) return Response.json({ error: "Too many reports, try again in a minute." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { token?: unknown; sample?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!isAddress(token, { strict: false })) {
    return Response.json({ error: "Paste a token contract address: 0x followed by 40 characters." }, { status: 400 });
  }
  // Local development only: a sample report, with nothing paid and nothing counted (see research-sample.ts).
  const sample = researchSampleMode(body?.sample === true);
  if (!sample && !playgroundPaymentsEnabled()) return Response.json({ error: "Reports aren't live yet." }, { status: 503 });

  const allowance = sample
    ? { ok: true as const, subject: "", left: researchFreeDaily() }
    : await reserveReport(visitor).catch(() => null);
  if (!allowance) return Response.json({ error: "Reports are unavailable right now. Try again in a moment." }, { status: 503 });
  if (!allowance.ok) return Response.json({ error: allowance.detail, freeLeft: 0 }, { status: 429 });

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      // If the visitor leaves, the report still finishes what it paid for.
      const send = (e: ResearchEvent) => {
        if (open) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      const keepAlive = setInterval(() => send({ type: "ping" }), PING_MS);
      send({ type: "allowance", freeLeft: allowance.left });
      try {
        const outcome = sample ? await researchToken(token, send, sampleDeps(token)) : await researchToken(token, send);
        if (!sample && !outcome.ok && outcome.refund) {
          await returnReport(allowance.subject).catch(() => {});
          send({ type: "allowance", freeLeft: allowance.left + 1 });
        }
      } catch (e) {
        console.error("research report failed", e);
        // Whether it was paid isn't known here, so the free report stays used.
        send({ type: "error", message: "The report stopped partway through. Any payment it made is still on-chain." });
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
