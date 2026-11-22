import type { Metadata } from "next";
import Link from "next/link";
import { BURN_BPS, burnFactory } from "@/lib/burn";
import { TOKEN } from "@/lib/constants";
import { baseCoverage } from "@/lib/gateway";
import { Faq, Page } from "../ui";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Common questions about Autonomo: whether it takes a cut of payments, whether it hosts your API, what launching costs, which networks work, and how to keep an agent's wallet safe.",
};

const FAQ: [string, React.ReactNode][] = [
  [
    "Does Autonomo take a cut of payments?",
    burnFactory() ? (
      <>Autonomo keeps none of it, but <Link href="/docs/token#burn">{BURN_BPS / 100}% of each payment is burned</Link>. On hosted gateways, payments go from the agent&apos;s wallet to your own splitter contract and wait there until it&apos;s flushed, which happens when it reaches 1,000 {TOKEN.symbol} or 0.10 USDG, or otherwise once a day if it holds at least 100 {TOKEN.symbol}. Flushing sends {100 - BURN_BPS / 100}% to your <code>payTo</code> wallet and burns the rest. Nobody can take the money out of a splitter any other way, and anyone can flush one. Autonomo&apos;s facilitator settles each payment on-chain and pays the gas. Autonomo is only paid for its own <Link href="/docs/official-apis">official APIs</Link>.</>
    ) : (
      <>No. Payments go straight from the agent&apos;s wallet to your <code>payTo</code> wallet. For hosted gateways, Autonomo&apos;s facilitator settles the payment on-chain and pays the gas, but never holds the money. Autonomo is only paid for its own <Link href="/docs/official-apis">official APIs</Link>.</>
    ),
  ],
  [
    "Does Autonomo host my API?",
    <>No. Your API runs wherever it runs today. A <Link href="/docs/launch">hosted gateway</Link> sits in front of it, takes the payment and forwards the request; or you <Link href="/docs/self-hosted">run x402 yourself</Link> and Autonomo just lists it.</>,
  ],
  [
    "How much does it cost to launch?",
    <>Nothing. Launching a gateway and getting listed are free, whether your API comes from a facilitator catalog, the dashboard or the listing form.</>,
  ],
  [
    "Is the discovery API free?",
    <>Yes, with no key. See the <Link href="/api-docs">API reference</Link>.</>,
  ],
  [
    "Is it safe to give the MCP server a private key?",
    <>Use a new wallet just for your agent with a small balance, never your main wallet. The key stays on your computer and is only used to sign payments, the server only pays Autonomo gateways, and it stops at a per-call cap and a daily budget.</>,
  ],
  [
    "My listing is wrong or out of date. How do I fix it?",
    <>Open your project page and use <b>Suggest an edit</b>, or send the details through the <Link href="/submit">listing form</Link>. Edits are reviewed by hand.</>,
  ],
  [
    "Which networks are supported?",
    <>
      Hosted gateways and the official APIs take USDG or {TOKEN.symbol} on {TOKEN.chainName}
      {baseCoverage() === "all" ? ", or USDC on Base" : ""}.
      {baseCoverage() === "official" && " The official APIs also take USDC on Base."} Self-hosted APIs use whatever their
      facilitator supports: most listed endpoints settle on Base, followed by Solana, Polygon, Arbitrum and others.
      Testnet-only services are hidden. {baseCoverage() === "all" ? "Solana for gateways is" : "Base and Solana for gateways are"} on
      the <Link href="/roadmap">roadmap</Link>.
    </>,
  ],
];

export default function FaqPage() {
  return (
    <Page title="FAQ">
      <p>Short answers to what people ask most, with links to the guides that have the details.</p>
      <Faq items={FAQ} />
    </Page>
  );
}
