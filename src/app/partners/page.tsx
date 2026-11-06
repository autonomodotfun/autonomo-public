import type { Metadata } from "next";
import Link from "next/link";
import { PARTNERS, PartnerMark } from "@/components/partners";

export const metadata: Metadata = {
  title: "Partners",
  description: "The teams Autonomo works with, and what each partnership adds for API creators and agents.",
};

export default function PartnersPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">Partners</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">Who we work with</h1>
      <p className="mt-4 text-muted">Teams building with Autonomo, and what each one adds for API creators and agents.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {PARTNERS.map((p) => (
          <div key={p.name} className="rounded-lg border border-line p-5">
            <p className="font-mono text-xs tracking-wide text-faint uppercase">{p.what}</p>
            <h2 className="mt-3">
              <a href={p.href} target="_blank" rel="noopener noreferrer" className="inline-block no-underline">
                <PartnerMark partner={p} className="h-8 w-auto" />
              </a>
            </h2>
            <p className="mt-2 text-sm text-muted">{p.about}</p>
            {p.guide && (
              <Link href={p.guide.href} className="mt-3 inline-block text-sm">
                {p.guide.label} →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
