/* eslint-disable @next/next/no-img-element */

// Tokyo Futuro's own mark, as the Tokyo Futuro team sent it, unchanged, next to its name. The mark has a dark
// background of its own, so it reads the same on light and dark pages.
export function TokyoFuturoLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/tokyo-futuro-logo.jpg" alt="" width={160} height={160} className="aspect-square h-full w-auto shrink-0 rounded-md ring-1 ring-line" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight whitespace-nowrap text-ink">Tokyo Futuro</span>
    </span>
  );
}
