import Link from "next/link";
import { ADMIN_EVENT_LABELS, recentAdminEvents, type AdminEventKind } from "@/lib/admin-log";
import { when } from "./ui";

const GROUPS: Record<string, { label: string; kinds?: AdminEventKind[] }> = {
  all: { label: "Everything" },
  listings: { label: "API listings", kinds: ["listing_approved", "listing_rejected"] },
  apis: { label: "Pauses and visibility", kinds: ["api_paused", "api_resumed", "project_hidden", "project_shown", "project_featured", "project_unfeatured"] },
  directory: { label: "Directory submissions", kinds: ["submission_approved", "submission_rejected"] },
  payouts: { label: "Payouts and wallets", kinds: ["pay_to_set", "pay_to_request_approved", "pay_to_request_rejected", "wallet_switched"] },
};
const LIMIT = 200;
const WARN: AdminEventKind[] = ["listing_rejected", "submission_rejected", "pay_to_request_rejected", "api_paused", "project_hidden"];

/** The History tab: every decision made from this page, newest first. */
export async function HistoryTab({ group: rawGroup }: { group: string }) {
  const group = rawGroup in GROUPS ? rawGroup : "all";
  const events = await recentAdminEvents(LIMIT, GROUPS[group].kinds);

  return (
    <section>
      <h2 className="text-lg font-semibold">History</h2>
      <p className="mt-1 text-sm text-muted">Every decision made from this page, newest first. Times are in UTC. It starts on the day this tab was added.</p>
      <nav aria-label="Filter" className="mt-3 flex flex-wrap gap-1 text-sm">
        {Object.entries(GROUPS).map(([k, g]) => (
          <Link key={k} href={`/admin?tab=history${k === "all" ? "" : `&group=${k}`}`} aria-current={group === k ? "page" : undefined} className={`rounded-md px-2.5 py-1 ${group === k ? "bg-surface font-medium text-ink" : "text-muted hover:text-ink"}`}>
            {g.label}
          </Link>
        ))}
      </nav>

      {events === null ? (
        <p className="mt-6 rounded-lg border border-warn p-4 text-sm">
          <span className="font-medium text-warn">History isn&apos;t recording yet.</span> Its table is missing from this
          database. Run the database update (<code>npm run db:migrate</code>) against it once. Until then every action on
          the other tabs still works; it just isn&apos;t written down.
        </p>
      ) : events.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line p-6 text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ol className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
          {events.map((e) => (
            <li key={e.id} className="grid gap-x-4 gap-y-1 p-3 sm:grid-cols-[9.5rem_1fr]">
              <time className="font-mono text-xs text-faint">{when(e.createdAt)}</time>
              <div>
                <p>
                  <span className={`font-medium ${WARN.includes(e.kind as AdminEventKind) ? "text-warn" : ""}`}>{ADMIN_EVENT_LABELS[e.kind as AdminEventKind] ?? e.kind}</span>{" "}
                  <span className="font-mono text-xs break-all text-muted">{e.subject}</span>
                </p>
                {e.detail && <p className="mt-0.5 text-xs break-all text-muted">{e.detail}</p>}
                {e.note && <p className="mt-0.5 text-xs">Reason given: {e.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {events?.length === LIMIT && <p className="mt-3 text-sm text-muted">Showing the newest {LIMIT}.</p>}
    </section>
  );
}
