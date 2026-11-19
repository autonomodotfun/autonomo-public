import Link from "next/link";
import { BorroLogo } from "@/components/borro-logo";
import { GloamLogo } from "@/components/gloam-logo";
import { OstraLogo } from "@/components/ostra-logo";
import { StoaLogo } from "@/components/stoa-logo";
import { TokyoFuturoLogo } from "@/components/tokyo-futuro-logo";

// Partners we've agreed to list, shown on /partners and in the homepage row. Add one only after they've said yes,
// with logo files from their own brand kit.
export type Partner = {
  name: string;
  Logo?: (props: { className?: string }) => React.ReactNode;
  href: string;
  what: string;
  about: string;
  guides?: { href: string; label: string }[];
};

export const PARTNERS: Partner[] = [
  {
    name: "Gloam",
    Logo: GloamLogo,
    href: "https://gloam.trade",
    what: "Private payments",
    about:
      "Agents can pay any API on Autonomo that accepts USDG from a private Gloam balance, so the payment doesn't link back to their wallet.",
    guides: [{ href: "/docs/gloam", label: "Pay privately with Gloam" }],
  },
  {
    name: "Borro",
    Logo: BorroLogo,
    href: "https://borro.markets",
    what: "Agent credit",
    about:
      "Agents short on USDG can borrow what they need from a Borro credit line and pay for an Autonomo API in the same request.",
    guides: [{ href: "/docs/borro", label: "Pay with a Borro credit line" }],
  },
  {
    name: "Ostra",
    Logo: OstraLogo,
    href: "https://ostraagent.xyz",
    what: "Agent vault",
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
    about:
      "Stoa is a DEX aggregator on Robinhood Chain. Agents can check a token before buying and get a quote with ready-to-sign swap calldata, paid per call through Autonomo.",
    guides: [
      { href: "/projects/stoa-swap-quote-robinhood-chain", label: "Get a swap quote" },
      { href: "/projects/stoa-token-safety-check-robinhood-chain", label: "Check a token before buying" },
    ],
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

// The ticker shows the list four times: two identical halves, each long enough to fill a wide screen on its own.
const TICKER_COPIES = 4;

/** One line for the homepage: "Use with", then a slow ticker of partners, each its logo and what it adds, linking to
 * our guide for it (the partner's own site when there's none). Only the first copy can be read or tabbed to; the
 * repeats are there for the loop. With motion turned off it's a plain wrapping row of that first copy. */
export function PartnersRow() {
  if (!PARTNERS.length) return null;
  const item = "mr-10 flex shrink-0 items-center gap-3 no-underline opacity-90 transition-opacity hover:opacity-100";
  const items = Array.from({ length: TICKER_COPIES }, (_, copy) =>
    PARTNERS.map((p) => {
      const repeat = copy > 0;
      const props = {
        className: `${item} ${repeat ? "ticker-copy" : ""}`,
        "aria-hidden": repeat || undefined,
        tabIndex: repeat ? -1 : undefined,
      };
      const inner = (
        <>
          <PartnerMark partner={p} className="h-6 w-auto" />
          <span className="text-xs whitespace-nowrap text-muted">{p.what}</span>
        </>
      );
      const guide = p.guides?.[0];
      return guide ? (
        <Link key={`${copy}-${p.name}`} href={guide.href} title={guide.label} {...props}>
          {inner}
        </Link>
      ) : (
        <a key={`${copy}-${p.name}`} href={p.href} target="_blank" rel="noopener noreferrer" {...props}>
          {inner}
        </a>
      );
    }),
  ).flat();
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
      <span className="shrink-0 font-mono text-xs tracking-[0.14em] text-faint uppercase sm:border-r sm:border-line sm:pr-5">
        Use with
      </span>
      <div className="ticker min-w-0 flex-1 overflow-hidden sm:ml-5">
        <div className="ticker-track flex w-max items-center py-1" style={{ "--ticker-duration": `${PARTNERS.length * 8}s` } as React.CSSProperties}>
          {items}
        </div>
      </div>
    </div>
  );
}
