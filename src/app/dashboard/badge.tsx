export function Badge({ tone, children }: { tone: "ok" | "muted" | "warn"; children: React.ReactNode }) {
  const cls = { ok: "bg-accent-soft text-accent", muted: "bg-surface text-muted", warn: "bg-surface text-warn" }[tone];
  return <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase ${cls}`}>{children}</span>;
}
