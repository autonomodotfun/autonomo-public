/* eslint-disable @next/next/no-img-element */

// QHooks' own round mark, with the dark square around it cut away so only the emblem shows, next to its name.
export function QHooksLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/qhooks-logo.png" alt="" width={192} height={192} className="aspect-square h-full w-auto shrink-0" />
      <span className="text-[1.15em] leading-none font-medium tracking-tight text-ink">QHooks</span>
    </span>
  );
}
