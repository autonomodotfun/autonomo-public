"use client";

import { useState } from "react";

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); the text stays selectable.
    }
  }

  return (
    <button type="button" onClick={copy} aria-label={label} className={className}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
