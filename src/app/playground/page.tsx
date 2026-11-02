import type { Metadata } from "next";
import { webFreeDaily } from "@/lib/agent-limits";
import { exampleQuestion } from "@/lib/playground";
import { playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { listAutonomoGateways } from "@/lib/queries";
import { Playground, type AvailableApi } from "./playground";

export const metadata: Metadata = {
  title: "Agent Playground",
  description: "Ask about tokens, wallets and transactions on Robinhood Chain and watch an AI agent pay for the x402 APIs it needs in $AUTONOMO.",
};

export default async function PlaygroundPage() {
  const apis: AvailableApi[] = (await listAutonomoGateways()).map((g) => ({
    slug: g.slug,
    projectSlug: g.projectSlug,
    name: g.name,
    description: g.description,
    autonomo: Number(g.autonomoAmount).toLocaleString("en-US"),
    usdg: g.acceptUsdg ? String(Number(g.priceUsd)) : null,
    question: exampleQuestion(g.slug, g.name),
  }));
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-xs tracking-widest text-accent uppercase">
        <span className="h-2 w-2 rounded-full bg-brand" />
        Preview
      </span>
      <h1 className="heading mt-4 text-5xl sm:text-6xl">Agent Playground</h1>
      <p className="mt-3 text-lg text-muted">
        Ask about tokens, wallets and transactions on Robinhood Chain, then ask a follow-up. An AI agent picks the paid
        APIs it needs and pays for each one in $AUTONOMO. No wallet, no signup.
      </p>
      <Playground apis={apis} />
      <p className="mt-6 text-sm text-faint">
        {playgroundPaymentsEnabled()
          ? `Every payment is real: the agent reads the live 402 price and pays from its own wallet on Robinhood Chain. Free to try, ${webFreeDaily()} questions per visitor per day.`
          : "In this preview the search and the price check are real: the agent calls the API and reads its live 402 response. Paying, and with it the answer and receipt, goes live with the agent's wallet."}
      </p>
      <p className="mt-2 text-sm text-faint">
        We keep your questions and the answers for about 24 hours so you can ask follow-ups, and they go to our AI
        provider to be answered, so don&apos;t include anything private. Answers can be wrong and aren&apos;t financial advice.
      </p>
    </div>
  );
}
