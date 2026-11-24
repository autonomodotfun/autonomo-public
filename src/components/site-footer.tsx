import Link from "next/link";
import { bondEnabled } from "@/lib/trust/bond";
import { burnFactory } from "@/lib/payments/burn";
import { TOKEN } from "@/lib/constants";
import { CopyButton } from "@/components/copy-button";
import { Logo } from "@/components/logo";
import { SOCIALS, Socials } from "@/components/socials";

// The footer on every page: the brand with the social icons, three columns of links grouped by what people come
// for, and a bottom row with the token's contract address and where the directory's data comes from.

type FooterLink = { label: string; href: string; external?: boolean };

function columns(): { title: string; links: FooterLink[] }[] {
  return [
    {
      title: "Build",
      links: [
        { label: "Launch an API", href: "/dashboard" },
        { label: "API", href: "/api-docs" },
        { label: "Partners", href: "/partners" },
      ],
    },
    {
      title: "Token",
      links: [
        ...(burnFactory() ? [{ label: "Burn", href: "/burn" }] : []),
        ...(bondEnabled() ? [{ label: "Bond", href: "/bond" }] : []),
        { label: "Numbers", href: "/numbers" },
      ],
    },
    {
      title: "Community",
      links: SOCIALS.map((s) => ({ label: s.label, href: s.href, external: true })),
    },
  ];
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line text-sm">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-10 pb-8 sm:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))] sm:px-6">
        <div>
          <Link href="/" aria-label="Autonomo home" className="inline-block">
            <Logo className="h-6 w-auto" />
          </Link>
          <p className="mt-3 max-w-xs text-muted">Paid APIs for AI agents. Launch an API, set a price per call, and agents pay as they go.</p>
          <Socials className="mt-3 -ml-1.5" />
        </div>
        <div className="grid grid-cols-3 gap-4 sm:contents">
          {columns().map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <h2 className="font-mono text-xs tracking-wide text-faint uppercase">{c.title}</h2>
              <ul className="mt-3 space-y-2">
                {c.links.map((l) => (
                  <li key={l.href}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-muted hover:text-ink">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
            <span className="text-ink">{TOKEN.symbol} CA</span>
            <a href={`${TOKEN.explorer}/token/${TOKEN.address}`} className="break-all hover:text-ink">
              {TOKEN.address}
            </a>
            <CopyButton
              text={TOKEN.address}
              label={`Copy ${TOKEN.symbol} contract address`}
              className="rounded-sm border border-line px-1.5 py-0.5 uppercase hover:text-ink"
            />
          </p>
          <p>Directory data comes from the Coinbase CDP and PayAI discovery endpoints.</p>
        </div>
      </div>
    </footer>
  );
}
