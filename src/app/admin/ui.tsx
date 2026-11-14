import type { ReactNode } from "react";

/** A date and time the way the admin page shows them: 2026-11-14 09:30, in UTC. */
export const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

/** One labelled line of a review card. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-faint">{label}</dt>
      <dd className="font-mono break-all">{children}</dd>
    </div>
  );
}
