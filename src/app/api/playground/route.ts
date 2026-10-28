import { keywordsFrom, quote } from "@/lib/playground";
import type { PlaygroundEvent } from "@/lib/playground-events";
import { findEndpointsForKeywords } from "@/lib/queries";

export const maxDuration = 30;

// Preview of the Agent Playground: the agent really searches the catalog and really reads the 402 price.
// Paying (and so the answer) is switched off until the playground's agent wallet is live.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (limited(ip)) return Response.json({ error: "Too many questions, try again in a minute." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 200) : "";
  if (question.length < 3) return Response.json({ error: "Ask a question first." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: PlaygroundEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        send({ step: "search", state: "running", detail: "Searching Autonomo for a paid API…" });
        const keywords = keywordsFrom(question);
        const candidates = await findEndpointsForKeywords(keywords, 4);
        if (!candidates.length) {
          send({ step: "search", state: "fail", detail: "No paid API on Autonomo matches that yet. Try another question." });
          return;
        }

        // Take the first candidate that answers with a readable 402.
        let picked: { c: (typeof candidates)[number]; offers: { token: string; amount: string; network: string }[] } | null = null;
        for (const [i, c] of candidates.entries()) {
          if (i === 0) {
            send({ step: "search", state: "done", detail: `Found ${c.project.name}`, api: apiOf(c) });
            send({ step: "quote", state: "running", detail: "Calling it without paying to read the price…" });
          } else {
            send({ step: "search", state: "done", detail: `Trying ${c.project.name} instead`, api: apiOf(c) });
          }
          const q = await quote(c.url);
          if (q.ok) {
            picked = { c, offers: q.offers.map(({ token, amount, network }) => ({ token, amount, network })) };
            break;
          }
        }
        if (!picked) {
          send({ step: "quote", state: "fail", detail: "None of the matching APIs returned a price right now." });
          return;
        }

        const acceptsAutonomo = picked.offers.some((o) => o.token === "$AUTONOMO");
        send({ step: "quote", state: "done", detail: "402 Payment Required", offers: picked.offers, acceptsAutonomo });
        send({
          step: "pay",
          state: "soon",
          detail: acceptsAutonomo
            ? "The agent would pay in $AUTONOMO here. Its wallet goes live soon."
            : "This API doesn't take $AUTONOMO yet. Paying goes live with the agent wallet.",
        });
        send({ step: "answer", state: "soon", detail: "The answer and on-chain receipt unlock once the agent can pay." });
      } catch {
        send({ step: "search", state: "fail", detail: "Something went wrong. Try again." });
      } finally {
        send({ step: "end" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

function apiOf(c: Awaited<ReturnType<typeof findEndpointsForKeywords>>[number]) {
  return {
    name: c.project.name,
    slug: c.project.slug,
    url: c.url,
    description: c.description ?? c.project.description,
    autonomo: c.facilitator === "autonomo",
  };
}
