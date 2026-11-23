/* eslint-disable @next/next/no-img-element */

// Oak Agent Kit's own mark, as the Oak team sent it, next to its name. The mark has a dark background of its own, so
// it reads the same on light and dark pages.
export function OakLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/oak-logo.jpg" alt="" width={160} height={160} className="aspect-square h-full w-auto shrink-0 rounded-full ring-1 ring-line" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight whitespace-nowrap text-ink">Oak Agent Kit</span>
    </span>
  );
}
