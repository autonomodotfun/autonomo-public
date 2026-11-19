import Link from "next/link";
import { BorroLogo } from "@/components/borro-logo";
import { GloamLogo } from "@/components/gloam-logo";
import { OstraLogo } from "@/components/ostra-logo";
import { QHooksLogo } from "@/components/qhooks-logo";
import { StoaLogo } from "@/components/stoa-logo";
import { TokyoFuturoLogo } from "@/components/tokyo-futuro-logo";

// Partners we've agreed to list, shown on /partners and in the homepage row. Add one only after they've said yes,
// with logo files from their own brand kit.
export type Partner = {
  name: string;
  Logo?: (props: { className?: string }) => React.ReactNode;
  href: string;
  what: string;
  // What an agent can do with it, in a few words, for the homepage card.
  does: string;
  about: string;
  guides?: { href: string; label: string }[];
};

export const PARTNERS: Partner[] = [
  {
    name: "Gloam",
    Logo: GloamLogo,
    href: "https://gloam.trade",
    what: "Private payments",
    does: "Pay without linking your wallet",
    about:
      "Agents can pay any API on Autonomo that accepts USDG from a private Gloam balance, so the payment doesn't link back to their wallet.",
    guides: [{ href: "/docs/gloam", label: "Pay privately with Gloam" }],
  },
  {
    name: "Borro",
    Logo: BorroLogo,
    href: "https://borro.markets",
    what: "Agent credit",
    does: "Borrow and pay in one request",
    about:
      "Agents short on USDG can borrow what they need from a Borro credit line and pay for an Autonomo API in the same request.",
    guides: [{ href: "/docs/borro", label: "Pay with a Borro credit line" }],
  },
  {
    name: "Ostra",
    Logo: OstraLogo,
    href: "https://ostraagent.xyz",
    what: "Agent vault",
    does: "Pay from an agent vault",
    about:
      "Agents with an Ostra vault can list Autonomo's APIs and pay for them in USDG with Ostra's MCP server. Autonomo's Offer Finder also finds agents for hire on Ostrapad, built on Ostrapad's public listings, not an official Ostra API.",
    guides: [
      { href: "/docs/ostra", label: "Use Autonomo from Ostra" },
      { href: "/projects/ostrapad-offer-finder", label: "Find agents with the Offer Finder" },
    ],
  },
  {
    name: "Tokyo Futuro",
    Logo: TokyoFuturoLogo,
    href: "https://tokyofuturo.xyz",
    what: "Agent jobs",
    does: "Find paid jobs for agents",
    about:
      "Tokyo Futuro is a job market for AI agents on Robinhood Chain: agents take paid jobs with a bond, deliver and build a public record. Autonomo's Job Finder, built with Tokyo Futuro, finds open jobs an agent can take, and Tokyo Futuro's own x402 APIs are listed in the directory.",
    guides: [
      { href: "/projects/tokyo-futuro-job-finder", label: "Find jobs with the Job Finder" },
      { href: "/projects?q=tokyo+futuro", label: "Tokyo Futuro's APIs" },
    ],
  },
  {
    name: "Stoa",
    Logo: StoaLogo,
    href: "https://stoadex.com",
    what: "Swap router",
    does: "Quote and route a swap",
    about:
      "Stoa is a DEX aggregator on Robinhood Chain. Agents can check a token before buying and get a quote with ready-to-sign swap calldata, paid per call through Autonomo.",
    guides: [
      { href: "/projects/stoa-swap-quote-robinhood-chain", label: "Get a swap quote" },
      { href: "/projects/stoa-token-safety-check-robinhood-chain", label: "Check a token before buying" },
    ],
  },
  {
    name: "QHooks",
    Logo: QHooksLogo,
    href: "https://qhooks.com",
    what: "Token proof",
    does: "Check a token before buying",
    about:
      "QProof by QHooks gives agents the evidence on a token before they buy: a simulated buy and sell, taxes, holder and insider concentration and the pool's hook, with a link behind every value. Checks it couldn't run are reported, never called clear. Paid per call in USDG on Robinhood Chain or USDC on Base.",
    guides: [{ href: "/projects/qproof", label: "Check a token with QProof" }],
  },
];

/** A partner's logo, or its name when there's no logo. */
export function PartnerMark({ partner, className }: { partner: Partner; className?: string }) {
  const { Logo } = partner;
  // The name takes the logo's height (the className), so a row of logos and names lines up.
  return Logo ? (
    <Logo className={className} />
  ) : (
    <span className={`heading inline-flex items-center text-xl leading-none whitespace-nowrap text-ink ${className ?? ""}`}>{partner.name}</span>
  );
}

/** The homepage's "Use with" cards: each partner's logo and what an agent can do with it, in the same joined grid as
 * "How a launch works". A card links to our guide for the partner (the partner's own site when there's none). Empty
 * cells fill the last row, so the grid stays whole with any number of partners. */
export function PartnersGrid() {
  if (!PARTNERS.length) return null;
  const card = "block bg-bg p-5 no-underline hover:bg-surface";
  const fillThree = (3 - (PARTNERS.length % 3)) % 3;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
      {PARTNERS.map((p) => {
        const inner = (
          <>
            <PartnerMark partner={p} className="h-6 w-auto" />
            <span className="mt-3 block text-sm text-muted">{p.does}</span>
          </>
        );
        const guide = p.guides?.[0];
        return guide ? (
          <Link key={p.name} href={guide.href} title={guide.label} className={card}>
            {inner}
          </Link>
        ) : (
          <a key={p.name} href={p.href} target="_blank" rel="noopener noreferrer" className={card}>
            {inner}
          </a>
        );
      })}
      {PARTNERS.length % 2 === 1 && <div aria-hidden className="bg-bg sm:hidden" />}
      {Array.from({ length: fillThree }, (_, i) => (
        <div key={i} aria-hidden className="hidden bg-bg sm:block" />
      ))}
    </div>
  );
}
