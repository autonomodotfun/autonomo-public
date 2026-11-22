/* eslint-disable @next/next/no-img-element */

// Raeto's own mark, as the Raeto team sent it, cropped closer to the mark so it reads at small sizes, next to its name.
// The mark has a light background of its own, so it reads the same on light and dark pages.
export function RaetoLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/raeto-logo.jpg" alt="" width={160} height={160} className="aspect-square h-full w-auto shrink-0 rounded-md ring-1 ring-line" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight text-ink">Raeto</span>
    </span>
  );
}
