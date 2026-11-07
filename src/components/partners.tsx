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
];

/** A partner's logo, or its name when there's no logo. */
export function PartnerMark({ partner, className }: { partner: Partner; className?: string }) {
  const { Logo } = partner;
  return Logo ? <Logo className={className} /> : <span className="heading text-xl text-ink">{partner.name}</span>;
}

/** One row of partner logos for the homepage: "Works with", then each logo. */
export function PartnersRow() {
  if (!PARTNERS.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
      <span className="text-sm text-muted">Works with</span>
      <span className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {PARTNERS.map((p) => (
          <a key={p.name} href={p.href} target="_blank" rel="noopener noreferrer" className="no-underline" title={p.what}>
            <PartnerMark partner={p} className="h-7 w-auto" />
          </a>
        ))}
      </span>
    </div>
  );
}
