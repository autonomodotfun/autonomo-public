import type { Metadata } from "next";
import { playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { Playground } from "./playground";

export const metadata: Metadata = {
  title: "Agent Playground",
  description: "Ask a question and watch an AI agent find a paid x402 API on Autonomo, check its price and pay for it in $AUTONOMO.",
};

export default function PlaygroundPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-xs tracking-widest text-accent uppercase">
        <span className="h-2 w-2 rounded-full bg-brand" />
        Preview
      </span>
      <h1 className="heading mt-4 text-5xl sm:text-6xl">Agent Playground</h1>
      <p className="mt-3 text-lg text-muted">
        Ask a question and watch an AI agent find a paid API on Autonomo, check its price and pay for it in $AUTONOMO.
        No wallet, no signup.
      </p>
      <Playground />
      <p className="mt-6 text-sm text-faint">
        {playgroundPaymentsEnabled()
          ? "Every step is real: the agent searches Autonomo, reads the live 402 price and pays from its own wallet on Robinhood Chain. Free to try, a few paid questions per visitor per day."
          : "In this preview the search and the price check are real: the agent calls the API and reads its live 402 response. Paying, and with it the answer and receipt, goes live with the agent's wallet."}
      </p>
    </div>
  );
}
