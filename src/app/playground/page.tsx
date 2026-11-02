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
  return <Playground apis={apis} freeDaily={webFreeDaily()} paymentsOn={playgroundPaymentsEnabled()} />;
}
