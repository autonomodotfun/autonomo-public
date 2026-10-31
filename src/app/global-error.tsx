"use client";

import "./globals.css";

// Last-resort page when even the root layout fails. Same message as error.tsx, without the site chrome.
export default function GlobalError() {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <div className="mx-auto max-w-2xl px-4 pt-24 sm:px-6">
          <p className="font-mono text-xs tracking-widest text-accent uppercase">Updating</p>
          <h1 className="heading mt-4 text-5xl leading-none">We&apos;re upgrading Autonomo</h1>
          <p className="mt-5 text-lg text-muted">
            The site is being updated right now. Please check back later. Your tokens and wallet live on Robinhood
            Chain and aren&apos;t affected.
          </p>
          <a href="https://x.com/useautonomo" className="mt-8 inline-block underline underline-offset-2">
            Updates on X
          </a>
        </div>
      </body>
    </html>
  );
}
