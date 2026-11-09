import Link from "next/link";
import { BorroLogo } from "@/components/borro-logo";
import { GloamLogo } from "@/components/gloam-logo";
import { OstraLogo } from "@/components/ostra-logo";

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
];

/** A partner's logo, or its name when there's no logo. */
export function PartnerMark({ partner, className }: { partner: Partner; className?: string }) {
  const { Logo } = partner;
  return Logo ? <Logo className={className} /> : <span className="heading text-xl text-ink">{partner.name}</span>;
}

/** One row for the homepage: "Use with", then each partner as a chip with its logo and what it adds, linking to our
 * guide for it (the partner's own site when there's none). */
export function PartnersRow() {
  if (!PARTNERS.length) return null;
  const chip =
    "flex items-center gap-3 rounded-lg border border-line bg-surface py-2 pr-4 pl-3 no-underline transition-colors hover:border-faint";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="mr-1 w-full font-mono text-xs tracking-[0.14em] text-faint uppercase sm:w-auto">Use with</span>
      {PARTNERS.map((p) => {
        const inner = (
          <>
            <PartnerMark partner={p} className="h-6 w-auto" />
            <span className="border-l border-line pl-3 text-xs whitespace-nowrap text-muted">{p.what}</span>
          </>
        );
        const guide = p.guides?.[0];
        return guide ? (
          <Link key={p.name} href={guide.href} title={guide.label} className={chip}>
            {inner}
          </Link>
        ) : (
          <a key={p.name} href={p.href} target="_blank" rel="noopener noreferrer" className={chip}>
            {inner}
          </a>
        );
      })}
    </div>
  );
}
