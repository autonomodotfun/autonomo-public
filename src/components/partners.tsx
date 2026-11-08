import { BorroLogo } from "@/components/borro-logo";
import { GloamLogo } from "@/components/gloam-logo";

// Partners we've agreed to list, shown on /partners and in the homepage row. Add one only after they've said yes,
// with logo files from their own brand kit.
export type Partner = {
  name: string;
  Logo?: (props: { className?: string }) => React.ReactNode;
  href: string;
  what: string;
  about: string;
  guide?: { href: string; label: string };
};

export const PARTNERS: Partner[] = [
  {
    name: "Gloam",
    Logo: GloamLogo,
    href: "https://gloam.trade",
    what: "Private payments",
    about:
      "Agents can pay any API on Autonomo that accepts USDG from a private Gloam balance, so the payment doesn't link back to their wallet.",
    guide: { href: "/docs/gloam", label: "Pay privately with Gloam" },
  },
  {
    name: "Borro",
    Logo: BorroLogo,
    href: "https://borro.markets",
    what: "Agent credit",
    about:
      "Agents short on USDG can borrow what they need from a Borro credit line and pay for an Autonomo API in the same request.",
    guide: { href: "/docs/borro", label: "Pay with a Borro credit line" },
  },
];

/** A partner's logo, or its name when there's no logo. */
export function PartnerMark({ partner, className }: { partner: Partner; className?: string }) {
  const { Logo } = partner;
  return Logo ? <Logo className={className} /> : <span className="heading text-xl text-ink">{partner.name}</span>;
}

/** One row for the homepage: "Works with", then each partner as a chip with its logo and what it adds. */
export function PartnersRow() {
  if (!PARTNERS.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="mr-1 w-full font-mono text-xs tracking-[0.14em] text-faint uppercase sm:w-auto">Works with</span>
      {PARTNERS.map((p) => (
        <a
          key={p.name}
          href={p.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-line bg-surface py-2 pr-4 pl-3 no-underline transition-colors hover:border-faint"
        >
          <PartnerMark partner={p} className="h-6 w-auto" />
          <span className="border-l border-line pl-3 text-xs whitespace-nowrap text-muted">{p.what}</span>
        </a>
      ))}
    </div>
  );
}
