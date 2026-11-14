import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import { payeeOf } from "@/lib/gateway";
import { setApiStatus, setProjectFlags } from "./actions";
import { when } from "./ui";

const SHOW = { all: "All", listed: "Listed", pending: "Waiting", unlisted: "Not listed", rejected: "Rejected", paused: "Paused" } as const;
export type ApiFilter = keyof typeof SHOW;
const LIMIT = 200;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The All APIs tab: every API launched through Autonomo, with what it earns and the switches for each. */
export async function ApisTab({ q, show }: { q: string; show: ApiFilter }) {
  const db = await getDb();
  const { gateways, gatewayCalls, projects } = schema;
  const filters: SQL[] = [];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(gateways.name, like), ilike(gateways.slug, like), ilike(gateways.owner, like))!);
  }
  if (show === "paused") filters.push(eq(gateways.status, "paused"));
  else if (show !== "all") filters.push(eq(gateways.listing, show));

  const rows = await db
    .select({ g: gateways, projectSlug: projects.slug, projectStatus: projects.status, featured: projects.featured })
    .from(gateways)
    .leftJoin(projects, eq(projects.id, gateways.projectId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(gateways.createdAt))
    .limit(LIMIT);
  const ids = rows.map((r) => r.g.id);
  const calls = ids.length
    ? await db
        .select({
          id: gatewayCalls.gatewayId,
          calls: sql<number>`count(*)::int`,
          settled: sql<number>`count(*) filter (where ${gatewayCalls.settled})::int`,
          last: sql<Date | string | null>`max(${gatewayCalls.createdAt})`,
        })
        .from(gatewayCalls)
        .where(and(inArray(gatewayCalls.gatewayId, ids), sql`${gatewayCalls.createdAt} > now() - interval '30 days'`))
        .groupBy(gatewayCalls.gatewayId)
    : [];
  const byApi = new Map(calls.map((c) => [c.id, c]));
  const href = (patch: { show?: ApiFilter; q?: string }) => {
    const p = new URLSearchParams({ tab: "apis" });
    const s = patch.show ?? show;
    const query = patch.q ?? q;
    if (s !== "all") p.set("show", s);
    if (query) p.set("q", query);
    return `/admin?${p}`;
  };

  return (
    <>
      <section>
        <h2 className="text-lg font-semibold">All APIs</h2>
        <p className="mt-1 text-sm text-muted">Every API launched through Autonomo, newest first. Paid calls are for the last 30 days.</p>

        <form action="/admin" className="mt-4 flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="tab" value="apis" />
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          <input name="q" type="search" defaultValue={q} placeholder="Name, paid address or creator wallet" aria-label="Search APIs" className="field w-72 py-1.5" />
          <button className="rounded-md border border-line px-3 py-1.5">Search</button>
          {q && (
            <Link href={href({ q: "" })} className="self-center text-muted underline">
              Clear
            </Link>
          )}
        </form>
        <nav aria-label="Filter" className="mt-3 flex flex-wrap gap-1 text-sm">
          {(Object.keys(SHOW) as ApiFilter[]).map((k) => (
            <Link key={k} href={href({ show: k })} aria-current={show === k ? "page" : undefined} className={`rounded-md px-2.5 py-1 ${show === k ? "bg-surface font-medium text-ink" : "text-muted hover:text-ink"}`}>
              {SHOW[k]}
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-line p-6 text-sm text-muted">{q || show !== "all" ? "Nothing matches." : "No API has been launched yet."}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
            {rows.map(({ g, projectSlug, projectStatus, featured }) => {
              const c = byApi.get(g.id);
              const hidden = projectStatus === "hidden";
              return (
                <li key={g.id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="font-medium">
                      {g.name} <span className="font-mono text-xs font-normal text-faint">/x/{g.slug}</span>
                    </p>
                    <p className="flex flex-wrap gap-1.5 text-xs">
                      <Tag tone={g.status === "active" ? "ok" : "warn"}>{g.status === "active" ? "Taking payments" : "Paused"}</Tag>
                      <Tag tone={g.listing === "listed" && !hidden ? "ok" : g.listing === "rejected" || hidden ? "warn" : "muted"}>
                        {hidden ? "Hidden" : { listed: "Listed", pending: "Waiting for review", unlisted: "Not listed", rejected: "Rejected" }[g.listing]}
                      </Tag>
                      {featured && <Tag tone="ok">Featured</Tag>}
                    </p>
                  </div>
                  <p className="mt-1 font-mono text-xs break-all text-muted">
                    {[g.acceptUsdg ? `$${Number(g.priceUsd)} USDG` : null, g.autonomoAmount ? `${g.autonomoAmount} $AUTONOMO` : null].filter(Boolean).join(" or ")} · creator{" "}
                    <Link href={href({ q: g.owner })} className="underline" title={g.owner}>
                      {short(g.owner)}
                    </Link>
                    {g.payTo ? ` · paid at ${short(payeeOf(g))}` : ""} · launched {when(g.createdAt).slice(0, 10)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {c ? `${c.calls} paid ${c.calls === 1 ? "call" : "calls"}, ${c.settled} settled, last ${when(new Date(c.last as string)).slice(0, 16)}` : "No paid calls in 30 days"}
                    <span className="text-faint"> · {g.upstreamUrl}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={setApiStatus}>
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="status" value={g.status === "active" ? "paused" : "active"} />
                      <button className="rounded-md border border-line px-2.5 py-1 hover:bg-surface">{g.status === "active" ? "Pause" : "Resume"}</button>
                    </form>
                    {projectSlug && (
                      <>
                        <form action={setProjectFlags}>
                          <input type="hidden" name="slug" value={projectSlug} />
                          <input type="hidden" name="status" value={hidden ? "approved" : "hidden"} />
                          <button className="rounded-md border border-line px-2.5 py-1 hover:bg-surface">{hidden ? "Show in directory" : "Hide from directory"}</button>
                        </form>
                        <form action={setProjectFlags}>
                          <input type="hidden" name="slug" value={projectSlug} />
                          <input type="hidden" name="featured" value={featured ? "off" : "on"} />
                          <button className="rounded-md border border-line px-2.5 py-1 hover:bg-surface">{featured ? "Stop featuring" : "Feature"}</button>
                        </form>
                        <Link href={`/projects/${projectSlug}`} className="text-muted underline hover:text-ink">
                          Directory page
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length === LIMIT && <p className="mt-3 text-sm text-muted">Showing the newest {LIMIT}. Search to find an older one.</p>}
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Hide or feature another project</h2>
        <p className="mt-1 text-sm text-muted">
          For directory projects that weren&apos;t launched here, such as imported ones. Use the last part of the project&apos;s
          page address as its slug.
        </p>
        <form action={setProjectFlags} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            Slug
            <input name="slug" required className="field w-56" placeholder="e.g. corbits" />
          </label>
          <label className="grid gap-1">
            Directory
            <select name="status" className="field w-36" defaultValue="">
              <option value="">No change</option>
              <option value="approved">Show</option>
              <option value="hidden">Hide</option>
            </select>
          </label>
          <label className="grid gap-1">
            Featured
            <select name="featured" className="field w-36" defaultValue="">
              <option value="">No change</option>
              <option value="on">Feature</option>
              <option value="off">Stop featuring</option>
            </select>
          </label>
          <button className="btn-brand px-3 py-2">Save</button>
        </form>
      </section>
    </>
  );
}

function Tag({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const color = tone === "ok" ? "border-accent text-accent" : tone === "warn" ? "border-warn text-warn" : "border-line text-faint";
  return <span className={`rounded-full border px-2 py-0.5 ${color}`}>{children}</span>;
}
