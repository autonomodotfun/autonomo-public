import "server-only";
import { answerFrom, gatewayPath, intentKeywords, keywordsFrom, quote } from "@/lib/playground";
import type { PlaygroundEvent } from "@/lib/playground-events";
import { payAndCall, playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { findAutonomoGateways } from "@/lib/queries";

// The Autonomo agent, shared by the Agent Playground and the Telegram bot: it searches Autonomo gateways that
// accept $AUTONOMO, reads the live 402 price, pays from the agent wallet and answers with the receipt.
// Spending limits live in playground-pay.ts; callers add their own per-user limits through `mayPay`.

export type AgentOptions = {
  /** Called right before paying; return a message to stop (for example a used-up daily allowance), or null to pay. */
  mayPay?: () => Promise<string | null> | string | null;
  /** Called after a successful payment, for per-user accounting. */
  onPaid?: (tx: string | null) => Promise<void> | void;
};

export async function runAgent(question: string, send: (e: PlaygroundEvent) => void, opts: AgentOptions = {}) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://autonomo.fun").replace(/\/$/, "");
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
    const stop = await opts.mayPay?.();
    if (stop) {
      send({ step: "pay", state: "fail", detail: stop });
      return;
    }

    const amount = Number(picked.g.autonomoAmount).toLocaleString("en-US");
    send({ step: "pay", state: "running", detail: `Signing an x402 payment of ${amount} $AUTONOMO…` });
    const paid = await payAndCall(picked.url, picked.g.autonomoAmount);
    if (!paid.ok) {
      send({ step: "pay", state: "fail", detail: paid.error });
      return;
    }
    await opts.onPaid?.(paid.tx);
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
    console.error("agent failed", e);
    send({ step: "search", state: "fail", detail: "Something went wrong. Try again." });
  } finally {
    send({ step: "end" });
  }
}
