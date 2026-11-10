import type { Metadata } from "next";
import { researchFreeDaily, webFreeDaily } from "@/lib/agent-limits";
import { exampleQuestion } from "@/lib/playground";
import { playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { listAutonomoGateways } from "@/lib/queries";
import { researchSampleMode, SAMPLE_PRICE } from "@/lib/research-sample";
import { Playground, type AvailableApi } from "./playground";
import type { ResearchPrice } from "./research";

export const metadata: Metadata = {
  title: "Agent Playground",
  description:
    "Ask about tokens, wallets and transactions on Robinhood Chain, or paste a token for a full research report, and watch an AI agent pay for the x402 APIs it needs in $AUTONOMO.",
};

/** What one research report pays for, in order (see src/lib/research.ts). */
const REPORT_CALLS: { step: ResearchPrice["step"]; slug: string }[] = [
  { step: "risk", slug: "token-risk" },
  { step: "launch", slug: "tx-explainer" },
  { step: "creator", slug: "wallet-portfolio" },
  { step: "holder", slug: "wallet-portfolio" },
];

// The page reads nothing from the request, so it can be cached and served to every visitor. The tab (?mode=research)
// and sample mode (?sample=1) are read from the address in the browser instead (see playground.tsx).
export default async function PlaygroundPage() {
  const gateways = await listAutonomoGateways();
  const apis: AvailableApi[] = gateways.map((g) => ({
    slug: g.slug,
    projectSlug: g.projectSlug,
    name: g.name,
    description: g.description,
    autonomo: Number(g.autonomoAmount).toLocaleString("en-US"),
    usdg: g.acceptUsdg ? String(Number(g.priceUsd)) : null,
    question: exampleQuestion(g.slug, g.name),
  }));

  const bySlug = new Map(gateways.filter((g) => g.autonomoAmount).map((g) => [g.slug, g]));
  const prices: ResearchPrice[] = REPORT_CALLS.flatMap(({ step, slug }) => {
    const g = bySlug.get(slug);
    return g ? [{ step, api: g.name, autonomo: Number(g.autonomoAmount).toLocaleString("en-US") }] : [];
  });
  // Local development only: sample reports, so the page can be worked on without paying. Always on when the
  // Playground wallet isn't set up, and with ?sample=1 otherwise. In production neither is ever offered.
  const sampleAllowed = researchSampleMode(true);
  const samplePrices: ResearchPrice[] = REPORT_CALLS.map(({ step, slug }) => ({ step, api: slug, autonomo: SAMPLE_PRICE }));

  return (
    <Playground
      apis={apis}
      freeDaily={webFreeDaily()}
      paymentsOn={playgroundPaymentsEnabled()}
      research={{
        freeDaily: researchFreeDaily(),
        live: playgroundPaymentsEnabled() && bySlug.has("token-risk"),
        prices,
        sample: sampleAllowed ? { always: researchSampleMode(), prices: samplePrices } : null,
      }}
    />
  );
}
