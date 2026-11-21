import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { TokenBar } from "@/components/token-bar";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { Socials } from "@/components/socials";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow-condensed" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Autonomo: the agentic x402 launchpad and directory", template: "%s · Autonomo" },
  description:
    "Launch your API with x402 and let AI agents pay for it per call. Discover thousands of paid endpoints, facilitators and SDKs, with live pricing and usage from facilitator discovery data.",
  twitter: { site: "@useautonomo", creator: "@useautonomo" },
};

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
            <SiteNav />
            {/* From md the full menu shows, and only from lg is there room for the social icons too. */}
            <Socials className="ml-auto md:hidden lg:flex" />
            <Link
              href="/dashboard"
              className="btn-brand whitespace-nowrap px-3 py-1.5 text-sm md:ml-auto lg:ml-0"
            >
              <span className="lg:hidden">Launch</span>
              <span className="hidden lg:inline">Launch your API</span>
            </Link>
          </div>
        </header>
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
