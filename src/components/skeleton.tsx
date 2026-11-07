// Placeholders for loading.tsx files. Next.js prefetches these with each link, so a click shows the next page's
// shape right away while its data loads, instead of leaving the old page on screen with no sign anything happened.

/** One grey block. Give it a size with className. */
export function Bone({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded bg-line/60 motion-safe:animate-pulse ${className}`} />;
}

/** Tells screen readers the page is loading; the bones themselves are hidden from them. */
export function Loading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** The eyebrow, title and intro most pages start with. */
export function HeadingBones({ wide = false }: { wide?: boolean }) {
  return (
    <>
      <Bone className="h-3 w-28" />
      <Bone className={`mt-3 h-10 ${wide ? "w-full max-w-2xl" : "w-72 max-w-full"}`} />
      <Bone className="mt-5 h-4 w-full max-w-xl" />
      <Bone className="mt-2 h-4 w-4/5 max-w-lg" />
    </>
  );
}

/** A list of rows, like the directory's results. */
export function RowBones({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <Bone className="size-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <Bone className="h-4 w-48 max-w-full" />
            <Bone className="mt-2 h-3 w-full max-w-md" />
          </div>
          <Bone className="hidden h-4 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** A grid of cards. */
export function CardBones({ cards = 3 }: { cards?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-lg border border-line p-4">
          <Bone className="h-4 w-32" />
          <Bone className="mt-3 h-3 w-full" />
          <Bone className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
