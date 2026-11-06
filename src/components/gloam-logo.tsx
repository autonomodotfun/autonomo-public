/* eslint-disable @next/next/no-img-element */

// Gloam's own wordmark files from gloam.trade/brand, unchanged: ink on light, white on dark.
// Their rules: don't recolour, stretch or add effects, keep clear space, and keep it at least 88 px wide.
export function GloamLogo({ className = "" }: { className?: string }) {
  return (
    <picture>
      <source srcSet="/gloam-wordmark-white.svg" media="(prefers-color-scheme: dark)" />
      <img src="/gloam-wordmark.svg" alt="Gloam" width={117} height={32} className={className} />
    </picture>
  );
}
