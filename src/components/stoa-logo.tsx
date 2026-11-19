/* eslint-disable @next/next/no-img-element */

// Stoa's own mark, as the Stoa team sent it, cropped to the columns so they read at small sizes, next to its name. The mark has a light background of its
// own, so it reads the same on light and dark pages.
export function StoaLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/stoa-logo.jpg" alt="" width={160} height={160} className="aspect-square h-full w-auto shrink-0 rounded-md ring-1 ring-line" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight text-ink">Stoa</span>
    </span>
  );
}
