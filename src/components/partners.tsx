import Link from "next/link";
import { BorroLogo } from "@/components/borro-logo";
import { GloamLogo } from "@/components/gloam-logo";
import { OakLogo } from "@/components/oak-logo";
import { PriorsLogo } from "@/components/priors-logo";
import { QHooksLogo } from "@/components/qhooks-logo";
import { RaetoLogo } from "@/components/raeto-logo";
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
    name: "Tokyo Futuro",
    Logo: TokyoFuturoLogo,
    href: "https://tokyofuturo.xyz",
    what: "Agent jobs",
    about:
      "Tokyo Futuro is a job market for AI agents on Robinhood Chain: agents take paid jobs with a bond, deliver and build a public record. Autonomo's Job Finder, built with Tokyo Futuro, finds open jobs an agent can take, and Tokyo Futuro's own x402 APIs are listed in the directory.",
    guides: [
      { href: "/docs/tokyo-futuro", label: "Find agent jobs on Tokyo Futuro" },
      { href: "/projects/tokyo-futuro-job-finder", label: "The Job Finder's page" },
      { href: "/projects?q=tokyo+futuro", label: "Tokyo Futuro's APIs" },
    ],
  },
  {
    name: "QHooks",
    Logo: QHooksLogo,
    href: "https://qhooks.com",
    what: "Token proof",
    about:
      "QProof by QHooks gives agents the evidence on a token before they buy: a simulated buy and sell, taxes, holder and insider concentration and the pool's hook, with a link behind every value. Checks it couldn't run are reported, never called clear. Paid per call in USDG on Robinhood Chain, or USDC on Base or Solana. QHooks also makes QWallets, where an agent can keep its savings with every withdrawal needing two keys.",
    guides: [
      { href: "/projects/qproof", label: "Check a token with QProof" },
      { href: "/docs/qwallet", label: "Keep an agent's savings in a QWallet" },
      { href: "/docs/qhooks", label: "Trade through QHooks' MCP" },
    ],
  },
  {
    name: "Raeto",
    Logo: RaetoLogo,
    href: "https://raeto.cc",
    what: "Agent record",
    about:
      "Raeto is the account layer for agentic finance on Robinhood Chain. Autonomo's official APIs have a public record there: Raeto reads the USDG their wallet receives from outside payers and publishes it as statements on-chain that anyone can check.",
    guides: [{ href: "https://raeto.cc/agent/26170", label: "See the official APIs' record" }],
  },
  {
    name: "Priors",
    Logo: PriorsLogo,
    href: "https://priors.trade",
    what: "Agent loans",
    about:
      "Priors lends USDG to ERC-8004 AI agents on Robinhood Chain, and every repayment is public. Autonomo's own test agent borrowed 5 USDG from Priors' pool, paid the New Launches API 38 seconds later and repaid a week on. The official APIs' agent has its payment wallet declared in the ERC-8004 identity registry, and Priors confirmed it on their side.",
    guides: [{ href: "https://priors.trade", label: "See how Priors works" }],
  },
  {
    name: "Oak Agent Kit",
    Logo: OakLogo,
    href: "https://oakagentkit.org",
    what: "Agent wallet",
    about:
      "Oak Agent Kit is a local wallet and tool kit for AI agents on Robinhood Chain, for Claude Code, Codex, Cursor and others. Keys stay on your computer, and every action is shown in chat for a yes before it is signed. From chat, an agent can get USDG, by a swap or a bridge in from Base, and top up the wallet that pays for Autonomo's APIs.",
    guides: [{ href: "/docs/quickstart#oak", label: "Fund your agent's wallet with Oak" }],
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

/** The homepage's "Use with" cards: each partner's two-word label as a tag above its logo, the way /partners shows
 * it, in one joined grid. A card links to our guide for the partner (the partner's own site when there's none). Empty
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
            <span className="mb-3 block font-mono text-xs tracking-wide text-faint uppercase">{p.what}</span>
            <PartnerMark partner={p} className="h-6 w-auto" />
          </>
        );
        const guide = p.guides?.[0];
        // A guide on this site opens here; a partner's own page opens in a new tab.
        return guide && guide.href.startsWith("/") ? (
          <Link key={p.name} href={guide.href} title={guide.label} className={card}>
            {inner}
          </Link>
        ) : (
          <a key={p.name} href={guide?.href ?? p.href} title={guide?.label} target="_blank" rel="noopener noreferrer" className={card}>
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
