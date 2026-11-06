import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { burnFactory } from "@/lib/burn";
import { Logo } from "@/components/logo";
import { SOCIALS, Socials } from "@/components/socials";
import { TokenBar } from "@/components/token-bar";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow-condensed" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Autonomo: the agentic x402 launchpad for APIs", template: "%s · Autonomo" },
  description:
    "Launch your API with x402 and let AI agents pay for it per call. Discover thousands of paid endpoints, facilitators and SDKs, with live pricing and usage from facilitator discovery data.",
  twitter: { site: "@useautonomo", creator: "@useautonomo" },
};

const NAV = [
  { href: "/projects", label: "Explore APIs" },
  { href: "/projects?category=facilitator", label: "Facilitators" },
  { href: "/projects?category=sdk", label: "SDKs" },
  { href: "/playground", label: "Playground" },
  { href: "/docs", label: "Docs" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh font-sans">
        <TokenBar />
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:gap-6 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5" aria-label="Autonomo home">
              <Logo className="h-7 w-auto" />
            </Link>
            <nav className="hidden gap-5 text-sm text-muted sm:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
            <Socials className="ml-auto" />
            <Link
              href="/dashboard"
              className="btn-brand whitespace-nowrap px-3 py-1.5 text-sm"
            >
              <span className="sm:hidden">Launch</span>
              <span className="hidden sm:inline">Launch your API</span>
            </Link>
          </div>
        </header>
        <main>{children}</main>
        <footer className="mt-24 border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
            <p>Service data comes from the Coinbase CDP and PayAI discovery endpoints and is refreshed regularly.</p>
            <p className="flex flex-wrap gap-4">
              <Link href="/docs" className="hover:text-ink">Docs</Link>
              <Link href="/api-docs" className="hover:text-ink">API</Link>
              {burnFactory() && <Link href="/burn" className="hover:text-ink">Burn</Link>}
              <Link href="/dashboard" className="hover:text-ink">Launch</Link>
              <Link href="/partners" className="hover:text-ink">Partners</Link>
              <a href="https://docs.x402.org" className="hover:text-ink">x402 docs</a>
              {SOCIALS.map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
                  {s.label}
                </a>
              ))}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
