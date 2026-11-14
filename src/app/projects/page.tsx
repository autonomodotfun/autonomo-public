import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES } from "@/db/schema";
import { shelve } from "@/lib/api-shelves";
import { CATEGORY_INFO } from "@/lib/categories";
import { TOKEN } from "@/lib/constants";
import { formatUsd, networkLabel } from "@/lib/networks";
import {
  getStats,
  getTrackRecords,
  listAutonomoGateways,
  parseProjectQuery,
  searchProjects,
  type ProjectQuery,
  type Sort,
} from "@/lib/queries";
import { Avatar, compact, ProjectList } from "@/components/project-row";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type AutonomoApi = Awaited<ReturnType<typeof listAutonomoGateways>>[number];

/** The Autonomo tab isn't a directory category, so it has its own parameter: /projects?view=autonomo. */
const AUTONOMO_VIEW = "/projects?view=autonomo";
const isAutonomoView = (params: Record<string, string | string[] | undefined>) => params.view === "autonomo";

// Autonomo APIs shown in the one-row strip above the directory; the rest are on the Autonomo tab.
const STRIP_SIZE = 4;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  if (isAutonomoView(params)) return { title: "Autonomo APIs", alternates: { canonical: AUTONOMO_VIEW } };
  const q = parseProjectQuery(params);
  const title = q.category ? `x402 ${CATEGORY_INFO[q.category].plural}` : q.q ? `“${q.q}”` : "Explore APIs";
  return { title, alternates: { canonical: q.category ? `/projects?category=${q.category}` : "/projects" } };
}

const SORT_LABELS: Record<Sort, string> = {
  relevance: "Relevance",
  popular: "Most used",
  new: "Newest",
  price: "Cheapest",
  name: "A–Z",
};

// Chains shown before "More chains"; the rest are a click away.
const TOP_NETWORKS = 6;

function href(base: ProjectQuery, patch: Partial<ProjectQuery>) {
  const merged = { ...base, page: undefined, limit: undefined, ...patch };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== "" && !(k === "page" && v === 1)) params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `/projects?${s}` : "/projects";
}

export default async function ProjectsPage({ searchParams }: Props) {
  const params = await searchParams;
  const autonomoView = isAutonomoView(params);
  const query = parseProjectQuery(params);
  // The Autonomo strip leads the first page of the plain list, and the paid-services and Robinhood Chain views.
  const showStrip =
    !autonomoView &&
    !query.q &&
    (query.page ?? 1) === 1 &&
    (!query.category || query.category === "service") &&
    (!query.network || query.network === TOKEN.network);
  const [result, stats, autonomoApis, records] = await Promise.all([
    autonomoView ? null : searchProjects(query),
    getStats(),
    // A failed read only hides the strip and the tab, so the directory still renders.
    listAutonomoGateways().catch(() => [] as AutonomoApi[]),
    showStrip ? getTrackRecords().catch(() => null) : Promise.resolve(null),
  ]);
  const unfiltered = !autonomoView && !query.q && !query.category && !query.network;

  const title = autonomoView
    ? "Autonomo APIs"
    : query.category
      ? CATEGORY_INFO[query.category].plural
      : query.q
        ? "Search results"
        : "Explore x402 APIs";

  // The strip's cards: the most-paid Autonomo APIs over the track-record window, in shelf order when tied.
  const inShelfOrder = shelve(autonomoApis).flatMap((s) => s.apis);
  const paid = (slug: string) => records?.[slug]?.settledCalls ?? 0;
  const stripApis = [...inShelfOrder].sort((a, b) => paid(b.slug) - paid(a.slug)).slice(0, STRIP_SIZE);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <header>
        <p className="font-mono text-xs tracking-wide text-accent uppercase">Directory</p>
        <h1 className="heading mt-2 text-4xl sm:text-5xl">{title}</h1>
        {unfiltered ? (
          <>
            <dl className="mt-5 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
              <NumberTile value={compact(stats.projects)} label="projects" />
              <NumberTile value={compact(stats.endpoints)} label="paid endpoints" />
              <NumberTile value={String(stats.networks.length)} label="chains" />
              <NumberTile value={compact(stats.calls30d)} label="paid calls in 30 days" />
            </dl>
            <p className="mt-2 text-xs text-faint">From the Coinbase CDP and PayAI catalogs, plus every API launched on Autonomo.</p>
          </>
        ) : autonomoView ? (
          <p className="mt-3 max-w-2xl text-muted">
            Autonomo&apos;s gateways on {TOKEN.chainName}: pay per call in USDG or {TOKEN.symbol}, no account or key. The
            ones marked On-chain read {TOKEN.chainName} directly.
          </p>
        ) : (
          <p className="mt-3 max-w-2xl text-muted">
            {compact(stats.projects)} projects and {compact(stats.endpoints)} paid endpoints across{" "}
            {stats.networks.length} chains, with {compact(stats.calls30d)} paid calls in the last 30 days. From the
            Coinbase CDP and PayAI catalogs.
          </p>
        )}

        <form action="/projects" role="search" className="mt-6 flex max-w-2xl gap-2">
          {query.category && <input type="hidden" name="category" value={query.category} />}
          {query.network && <input type="hidden" name="network" value={query.network} />}
          <input
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="Search APIs, hosts or tags"
            aria-label="Search the directory"
            className="field flex-1 py-2.5 text-base"
          />
          <button type="submit" className="btn-brand px-4 text-sm">
            Search
          </button>
        </form>

        <nav aria-label="Category" className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-1 border-b border-line text-sm whitespace-nowrap">
            <Tab active={!autonomoView && !query.category} href={href(query, { category: undefined })} label="All" />
            {autonomoApis.length > 0 && (
              <Tab active={autonomoView} href={AUTONOMO_VIEW} label="Autonomo" count={autonomoApis.length} />
            )}
            {CATEGORIES.filter((c) => stats.categories[c]).map((c) => (
              <Tab
                key={c}
                active={!autonomoView && query.category === c}
                href={href(query, { category: c })}
                label={CATEGORY_INFO[c].plural}
                count={stats.categories[c]}
              />
            ))}
          </ul>
        </nav>
      </header>

      {autonomoView ? (
        <AutonomoShelves apis={autonomoApis} />
      ) : (
        <>
          {showStrip && stripApis.length > 0 && (
            <section className="mt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium">
                  From Autonomo <span className="text-faint">· {autonomoApis.length} APIs</span>
                </h2>
                <Link href={AUTONOMO_VIEW} className="text-sm text-muted hover:text-ink">
                  See all {autonomoApis.length} →
                </Link>
              </div>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {stripApis.map((g, i) => (
                  // Two cards on phones, so the list still starts near the top; all four from tablet width.
                  <ApiCard key={g.slug} g={g} className={i >= 2 ? "max-sm:hidden" : ""} />
                ))}
              </ul>
            </section>
          )}
          {result && <Directory query={query} result={result} stats={stats} noteTags={unfiltered && autonomoApis.length > 0} />}
        </>
      )}
    </div>
  );
}

function NumberTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-bg px-4 py-3">
      <dd className="heading text-2xl sm:text-3xl">{value}</dd>
      <dt className="mt-0.5 text-xs text-muted">{label}</dt>
    </div>
  );
}

function ApiCard({ g, className = "" }: { g: AutonomoApi; className?: string }) {
  return (
    <li className={className}>
      <Link href={`/projects/${g.projectSlug}`} className="flex h-full gap-3 rounded-md border border-line bg-bg p-3 hover:border-faint">
        <Avatar name={g.name} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{g.name}</span>
          <span className="mt-0.5 line-clamp-2 text-xs text-muted">{g.description}</span>
          <span className="mt-1.5 block font-mono text-xs">
            {g.acceptUsdg ? `${formatUsd(g.priceUsd)} USDG` : ""}
            {g.acceptUsdg && g.autonomoAmount ? " · " : ""}
            {g.autonomoAmount ? `${Number(g.autonomoAmount).toLocaleString("en")} ${TOKEN.symbol}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The Autonomo tab: every Autonomo API on its shelf, as the Explore page showed them before the strip. */
function AutonomoShelves({ apis }: { apis: AutonomoApi[] }) {
  if (!apis.length) {
    return <p className="mt-8 rounded-lg border border-dashed border-line p-10 text-center text-muted">No Autonomo APIs are live right now.</p>;
  }
  return (
    <section className="mt-8 rounded-lg border border-line bg-surface p-5">
      <div className="flex justify-end">
        <Link href="/numbers" className="text-sm text-muted hover:text-ink">
          See how they perform →
        </Link>
      </div>
      {shelve(apis).map(({ shelf, apis: onShelf }) => (
        <div key={shelf.id} className="mt-6 first:mt-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="font-mono text-xs tracking-wide text-ink uppercase">{shelf.title}</h2>
            {shelf.onchain && <span className="rounded-full border border-accent px-2 py-0.5 text-[11px] text-accent">On-chain</span>}
            <span className="text-xs text-faint">{shelf.about}</span>
          </div>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {onShelf.map((g) => (
              <ApiCard key={g.slug} g={g} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

type SearchResult = Awaited<ReturnType<typeof searchProjects>>;
type Stats = Awaited<ReturnType<typeof getStats>>;

/** The directory list, with its heading, chain filter, sorting and pages. */
function Directory({ query, result, stats, noteTags }: { query: ProjectQuery; result: SearchResult; stats: Stats; noteTags: boolean }) {
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const sorts: Sort[] = query.q ? ["relevance", "popular", "new", "price", "name"] : ["popular", "new", "price", "name"];
  const filtered = !!(query.q || query.category || query.network);
  const topNetworks = stats.networks.slice(0, TOP_NETWORKS);
  const moreNetworks = stats.networks.slice(TOP_NETWORKS);
  const activeInMore = moreNetworks.some((n) => n.network === query.network);
  const heading = query.q ? "Results" : query.category ? `All ${CATEGORY_INFO[query.category].plural.toLowerCase()}` : "All x402 APIs";

  return (
    <>
      <div className="mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
        <h2 className="heading text-2xl sm:text-3xl">{heading}</h2>
        <span className="text-sm text-muted">
          <span className="font-mono text-ink">{result.total.toLocaleString("en")}</span>{" "}
          {result.total === 1 ? "project" : "projects"}
          {query.network && <> on {networkLabel(query.network)}</>}
          {query.q && <> for “{query.q}”</>}
          {noteTags && <> · Autonomo&apos;s own are tagged</>}
        </span>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[12rem_1fr]">
        <aside className="text-sm">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">Chain</h2>
          <ul className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
            <FilterLink active={!query.network} href={href(query, { network: undefined })} label="Any chain" />
            {topNetworks.map((n) => (
              <FilterLink
                key={n.network}
                active={query.network === n.network}
                href={href(query, { network: n.network })}
                label={networkLabel(n.network)}
                count={n.count}
              />
            ))}
          </ul>
          {moreNetworks.length > 0 && (
            <details className="mt-1 lg:mt-2" open={activeInMore}>
              <summary className="cursor-pointer rounded px-2 py-1 text-muted hover:text-ink">
                {moreNetworks.length} more chains
              </summary>
              <ul className="mt-1 flex flex-wrap gap-1 lg:block lg:space-y-0.5">
                {moreNetworks.map((n) => (
                  <FilterLink
                    key={n.network}
                    active={query.network === n.network}
                    href={href(query, { network: n.network })}
                    label={networkLabel(n.network)}
                    count={n.count}
                  />
                ))}
              </ul>
            </details>
          )}
        </aside>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {filtered && (
                <Link href="/projects" className="underline hover:text-ink">
                  Clear filters
                </Link>
              )}
            </p>
            <div className="flex flex-wrap gap-1 text-sm">
              {sorts.map((s) => (
                <Link
                  key={s}
                  href={href(query, { sort: s })}
                  aria-current={result.sort === s ? "true" : undefined}
                  className={`rounded-md px-2.5 py-1 ${result.sort === s ? "bg-ink text-bg" : "text-muted hover:bg-surface"}`}
                >
                  {SORT_LABELS[s]}
                </Link>
              ))}
            </div>
          </div>

          {result.rows.length ? (
            <ProjectList rows={result.rows} />
          ) : (
            <div className="rounded-lg border border-dashed border-line p-10 text-center text-muted">
              <p>Nothing matches these filters.</p>
              <p className="mt-2 text-sm">
                <Link href="/projects" className="underline">Clear filters</Link> or{" "}
                <Link href="/dashboard" className="underline">launch your API</Link>.
              </p>
            </div>
          )}

          {pages > 1 && (
            <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
              {result.page > 1 ? (
                <Link href={href(query, { page: result.page - 1 })} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface">
                  ← Previous
                </Link>
              ) : <span />}
              <span className="text-faint">
                Page <span className="font-mono">{result.page}</span> of <span className="font-mono">{pages.toLocaleString("en")}</span>
              </span>
              {result.page < pages ? (
                <Link href={href(query, { page: result.page + 1 })} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface">
                  Next →
                </Link>
              ) : <span />}
            </nav>
          )}
        </section>
      </div>
    </>
  );
}

function Tab({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 ${
          active ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"
        }`}
      >
        {label}
        {count !== undefined && <span className="font-mono text-xs text-faint">{compact(count)}</span>}
      </Link>
    </li>
  );
}

function FilterLink({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex justify-between gap-3 rounded px-2 py-1 ${
          active ? "bg-surface font-medium text-ink" : "text-muted hover:text-ink"
        } max-lg:border max-lg:border-line`}
      >
        <span>{label}</span>
        {count !== undefined && <span className="font-mono text-xs text-faint">{compact(count)}</span>}
      </Link>
    </li>
  );
}
