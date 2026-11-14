import type { Metadata } from "next";
import { researchFreeDaily, webFreeDaily } from "@/lib/agent-limits";
import { shelve } from "@/lib/api-shelves";
import { exampleQuestion } from "@/lib/playground";
import { playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { listAutonomoGateways } from "@/lib/queries";
import { researchSampleMode, SAMPLE_PRICE } from "@/lib/research-sample";
import { Playground, type ApiShelf, type AvailableApi } from "./playground";
import type { ResearchPrice } from "./research";

export const metadata: Metadata = {
  title: "Agent Playground",
  description:
    "Ask about tokens, creators, holders, wallets, transactions, payments and gas on Robinhood Chain, check a website or an x402 endpoint, or paste a token for a full research report, and watch an AI agent pay for the x402 APIs it needs in $AUTONOMO.",
};

/** What one research report pays for, in order (see src/lib/research.ts). */
const REPORT_CALLS: { step: ResearchPrice["step"]; slug: string }[] = [
  { step: "risk", slug: "token-risk" },
  { step: "dev", slug: "dev-wallet" },
  { step: "holders", slug: "holders-bundles" },
  { step: "launch", slug: "tx-explainer" },
  { step: "creator", slug: "wallet-portfolio" },
  { step: "holder", slug: "wallet-portfolio" },
];

// The example question shown for each shelf on the start screen: a mix of the well-known APIs and the newer ones.
const SHELF_EXAMPLE: Record<string, string> = {
  tokens: "token-risk",
  wallets: "dev-wallet",
  transactions: "gas-now",
  web: "website-check",
  partners: "ostrapad-offer-finder",
};

// The page reads nothing from the request, so it can be cached and served to every visitor. The tab (?mode=research)
// and sample mode (?sample=1) are read from the address in the browser instead (see playground.tsx).
export default async function PlaygroundPage() {
  const gateways = await listAutonomoGateways();
  const toApi = (g: (typeof gateways)[number]): AvailableApi => ({
    slug: g.slug,
    projectSlug: g.projectSlug,
    name: g.name,
    description: g.description,
    autonomo: Number(g.autonomoAmount).toLocaleString("en-US"),
    usdg: g.acceptUsdg ? String(Number(g.priceUsd)) : null,
    question: exampleQuestion(g.slug, g.name),
  });
  const shelves: ApiShelf[] = shelve(gateways).map(({ shelf, apis }) => ({
    id: shelf.id,
    title: shelf.title,
    onchain: shelf.onchain,
    apis: apis.map(toApi),
  }));
  // One example per shelf: the shelf's preferred API when it's live, else its first.
  const examples = shelves.map((s) => (s.apis.find((a) => a.slug === SHELF_EXAMPLE[s.id]) ?? s.apis[0]).question);

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
      shelves={shelves}
      examples={examples}
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
