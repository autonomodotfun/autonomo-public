"use client";

import { useEffect } from "react";
import { SOCIALS } from "@/components/socials";
import { TOKEN } from "@/lib/constants";

// Shown when a page can't load (usually the database or an upstream is briefly unavailable). It keeps the
// header and footer and tells visitors to check back later.
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-16 pb-8 sm:px-6 sm:pt-24">
      <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-xs tracking-widest text-accent uppercase">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
        </span>
        Updating
      </span>

      <h1 className="heading mt-5 text-5xl leading-none sm:text-6xl">
        We&apos;re upgrading <span className="bg-brand px-2 text-on-brand">Autonomo</span>
      </h1>
      <p className="mt-5 text-lg text-muted">This part of the site is being updated right now. Please check back later.</p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="font-mono text-xs tracking-widest text-accent uppercase">Your tokens are safe</p>
          <p className="mt-2 text-sm text-muted">
            {TOKEN.symbol} and your wallet live on Robinhood Chain, not on this website. Nothing on-chain is affected.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="font-mono text-xs tracking-widest text-accent uppercase">Live updates</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SOCIALS.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="underline decoration-faint underline-offset-2 hover:decoration-ink">
                {s.label}: {s.handle}
              </a>
            ))}
          </p>
        </div>
      </div>

      {error.digest && <p className="mt-8 font-mono text-xs text-faint">Reference: {error.digest}</p>}
    </div>
  );
}
