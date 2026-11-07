import { MIN_OUTSIDE_PAYERS, type TrackRecord } from "@/lib/track-record";

const dateFmt = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function speed(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** An API's track record on its project page, from its own paid calls through Autonomo. */
export function TrackRecordBlock({ record: r }: { record: TrackRecord }) {
  const facts: [string, string][] = [];
  if (r.isNew) facts.push(["Outside payers", `Fewer than ${MIN_OUTSIDE_PAYERS}`]);
  else {
    facts.push(["Outside payers", String(r.outsidePayers)]);
    facts.push(["Came back", String(r.repeatPayers)]);
  }
  if (r.privateCalls > 0) facts.push(["Private calls", String(r.privateCalls)]);
  facts.push(["Answered", r.successRate === null ? "Not enough calls yet" : `${Math.floor(r.successRate * 1000) / 10}%`]);
  if (r.medianMs !== null) facts.push(["Typical speed", speed(r.medianMs)]);
  facts.push(["Live since", dateFmt.format(new Date(r.liveSince))]);

  return (
    <section className="mt-10">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="heading text-xl">Track record</h2>
        {r.isNew && <span className="rounded border border-line px-1.5 py-px text-[11px] font-medium text-muted">New</span>}
      </div>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        From paid calls through Autonomo in the last {r.windowDays} days. Payments from the API&apos;s own wallets and
        Autonomo&apos;s test wallets aren&apos;t counted as payers.{!r.isNew && <> &ldquo;Came back&rdquo; means paid on 2 or more days.</>}
      </p>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-px overflow-hidden rounded-lg border border-line bg-line">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-bg px-4 py-3">
            <dt className="text-xs text-faint">{label}</dt>
            <dd className="mt-1 font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
