"use client";

import { useState } from "react";
import { TOKEN } from "@/lib/constants";

// Site-wide strip with the token contract address and a copy button.
export function TokenBar() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(TOKEN.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); the address stays selectable.
    }
  }

  const short = `${TOKEN.address.slice(0, 6)}…${TOKEN.address.slice(-4)}`;
  return (
    <div className="bg-brand text-on-brand">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-4 py-1.5 font-mono text-xs sm:px-6">
        <span className="font-semibold">{TOKEN.symbol}</span>
        <span className="opacity-70">CA</span>
        <span className="select-all" title={TOKEN.address}>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{TOKEN.address}</span>
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${TOKEN.symbol} contract address`}
          className="rounded-sm border border-on-brand/30 px-1.5 py-0.5 uppercase hover:bg-on-brand hover:text-brand"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
