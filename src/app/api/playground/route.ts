import { answerFrom, gatewayPath, intentKeywords, keywordsFrom, quote } from "@/lib/playground";
import type { PlaygroundEvent } from "@/lib/playground-events";
import { payAndCall, playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { findAutonomoGateways } from "@/lib/queries";

// Paying waits for on-chain settlement, and the first run may also send the one-time Permit2 approval.
export const maxDuration = 60;

// Agent Playground: the agent searches Autonomo gateways that accept $AUTONOMO, reads the live 402 price,
// pays from the playground wallet (when PLAYGROUND_AGENT_PRIVATE_KEY is set) and answers with the receipt.
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

  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://autonomo.fun").replace(/\/$/, "");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: PlaygroundEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        send({ step: "search", state: "running", detail: "Searching Autonomo for an API that takes $AUTONOMO…" });
        const candidates = await findAutonomoGateways([...keywordsFrom(question), ...intentKeywords(question)], 3);
        if (!candidates.length) {
          send({ step: "search", state: "fail", detail: "No API on Autonomo answers that yet. Try asking for the $AUTONOMO price." });
          return;
        }

        // Take the first gateway that answers with a readable 402 that includes $AUTONOMO.
        let picked: { g: (typeof candidates)[number]; url: string; offers: { token: string; amount: string; network: string }[] } | null = null;
        for (const [i, g] of candidates.entries()) {
          const path = gatewayPath(g.slug, question);
          if (path === null) {
            send({ step: "search", state: "fail", detail: `${g.name} needs a token contract address. Ask again with the 0x… address.` });
            return;
          }
          const url = `${site}/x/${g.slug}${path}`;
          const api = { name: g.name, slug: g.projectSlug, url, description: g.description || null, autonomo: true };
          send({ step: "search", state: "done", detail: i === 0 ? `Found ${g.name}` : `Trying ${g.name} instead`, api });
          if (i === 0) send({ step: "quote", state: "running", detail: "Calling it without paying to read the price…" });
          const q = await quote(url);
          if (q.ok && q.offers.some((o) => o.token === "$AUTONOMO")) {
            picked = { g, url, offers: q.offers.map(({ token, amount, network }) => ({ token, amount, network })) };
            break;
          }
        }
        if (!picked) {
          send({ step: "quote", state: "fail", detail: "None of the matching APIs returned a $AUTONOMO price right now." });
          return;
        }
        send({ step: "quote", state: "done", detail: "402 Payment Required", offers: picked.offers, acceptsAutonomo: true });

        if (!playgroundPaymentsEnabled() || !picked.g.autonomoAmount) {
          send({ step: "pay", state: "soon", detail: "The agent would pay in $AUTONOMO here. Its wallet goes live soon." });
          send({ step: "answer", state: "soon", detail: "The answer and on-chain receipt unlock once the agent can pay." });
          return;
        }
        if (over(payments, ip, DAY, 5, false)) {
          send({ step: "pay", state: "fail", detail: "You've used today's free paid questions. Come back tomorrow." });
          return;
        }

        const amount = Number(picked.g.autonomoAmount).toLocaleString("en-US");
        send({ step: "pay", state: "running", detail: `Signing an x402 payment of ${amount} $AUTONOMO…` });
        over(payments, ip, DAY, 5);
        const paid = await payAndCall(picked.url, picked.g.autonomoAmount);
        if (!paid.ok) {
          send({ step: "pay", state: "fail", detail: paid.error });
          return;
        }
        send({
          step: "pay",
          state: "done",
          detail: paid.tx ? "Settled on Robinhood Chain" : "Paid",
          amount: Number(paid.amount).toLocaleString("en-US"),
          tx: paid.tx,
          explorer: paid.explorer,
        });
        send({ step: "answer", state: "done", detail: `Answered from ${picked.g.name}`, text: answerFrom(paid.data) });
      } catch (e) {
        console.error("playground failed", e);
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
