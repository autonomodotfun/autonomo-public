/* eslint-disable @next/next/no-img-element */

// Ostra's own mark, as the Ostra team sent it, unchanged, next to its name. The mark has a white background of its
// own, so it reads the same on light and dark pages.
export function OstraLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/ostra-logo.png" alt="" width={128} height={128} className="aspect-square h-full w-auto shrink-0 rounded-md ring-1 ring-line" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight text-ink">Ostra</span>
    </span>
  );
}
