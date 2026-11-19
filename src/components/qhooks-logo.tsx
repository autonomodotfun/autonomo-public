/* eslint-disable @next/next/no-img-element */

// QHooks' own mark, unchanged, next to its name. The mark has a dark background of its own, so it reads the same on
// light and dark pages.
export function QHooksLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/qhooks-logo.jpg" alt="" width={160} height={160} className="aspect-square h-full w-auto shrink-0 rounded-md ring-1 ring-line" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight text-ink">QHooks</span>
    </span>
  );
}
