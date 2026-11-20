/* eslint-disable @next/next/no-img-element */

// Tokyo Futuro's own mark, as the Tokyo Futuro team sent it, with its black background cut away so the sun sits on
// the page itself, next to its name.
export function TokyoFuturoLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/tokyo-futuro-logo.png" alt="" width={192} height={192} className="aspect-square h-full w-auto shrink-0" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight whitespace-nowrap text-ink">Tokyo Futuro</span>
    </span>
  );
}
