import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES, type Category } from "@/db/schema";
import { shelve } from "@/lib/api-shelves";
import { CATEGORY_INFO } from "@/lib/categories";
import { TOKEN } from "@/lib/constants";
import { networkLabel } from "@/lib/networks";
import {
  getDirectoryFacets,
  getStats,
  getTrackRecords,
  listAutonomoGateways,
  parseProjectQuery,
  searchProjects,
  type DirectoryFacets,
  type ProjectQuery,
  type Sort,
} from "@/lib/queries";
import { PRICE_BANDS, priceBand, topic, TOPICS } from "@/lib/topics";
import { ApiCard, mostPaid, type AutonomoApi } from "@/components/api-card";
import { FilterSheet } from "@/components/filter-sheet";
import { compact, ProjectList } from "@/components/project-row";
import { baseCoverage } from "@/lib/gateway";

// The Explore page has three tabs. "All APIs" lists the paid services, live ones first, with filters beside the
// list. "Autonomo" shows Autonomo's own APIs on their shelves. "Ecosystem" holds everything that isn't a paid
// service: facilitators, SDKs, extensions, tools and explorers.

type Params = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Params> };
type View = "apis" | "autonomo" | "ecosystem";

const AUTONOMO_VIEW = "/projects?view=autonomo";
/** The kinds of project on the Ecosystem tab. */
const ECOSYSTEM = CATEGORIES.filter((c) => c !== "service");

// Autonomo APIs shown in the one-row strip above the directory; the rest are on the Autonomo tab.
const STRIP_SIZE = 4;
// Chains shown before "More chains"; the rest are a click away.
const TOP_NETWORKS = 5;

/** What the address asks for: the tab, and on "All APIs" whether services without recent calls are shown too. */
type State = {
  view: View;
  q?: string;
  /** Only on the Ecosystem tab: one kind of project. */
  category?: Category;
  network?: string;
  topic?: string;
  price?: string;
  /** Show every service, not only those with a paid call in the last 30 days. */
  all?: boolean;
  sort?: Sort;
  page?: number;
};

function readState(params: Params): State {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const query = parseProjectQuery(params);
  const base = { q: query.q, sort: query.sort, page: query.page };
  if (one("view") === "autonomo") return { view: "autonomo" };
  if (one("view") === "ecosystem" || (query.category && query.category !== "service")) {
    return { ...base, view: "ecosystem", category: query.category === "service" ? undefined : query.category };
  }
  return { ...base, view: "apis", network: query.network, topic: query.topic, price: query.price, all: one("all") === "1" };
}

/** The address of a state. Moving to another filter or sort starts again from the first page. */
function href(s: State): string {
  if (s.view === "autonomo") return AUTONOMO_VIEW;
  const p = new URLSearchParams();
  if (s.view === "ecosystem" && !s.category) p.set("view", "ecosystem");
  if (s.q) p.set("q", s.q);
  if (s.category) p.set("category", s.category);
  if (s.network) p.set("network", s.network);
  if (s.topic) p.set("topic", s.topic);
  if (s.price) p.set("price", s.price);
  if (s.all) p.set("all", "1");
  if (s.sort) p.set("sort", s.sort);
  if (s.page && s.page > 1) p.set("page", String(s.page));
  const query = p.toString();
  return query ? `/projects?${query}` : "/projects";
}

/** The search the list runs for a state. */
function searchFor(s: State): ProjectQuery {
  const shared = { q: s.q, sort: s.sort, page: s.page };
  return s.view === "ecosystem"
    ? { ...shared, category: s.category, ecosystem: true }
    : { ...shared, category: "service", network: s.network, topic: s.topic, price: s.price, active: !s.all };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const s = readState(await searchParams);
  if (s.view === "autonomo") return { title: "Autonomo APIs", alternates: { canonical: AUTONOMO_VIEW } };
  if (s.view === "ecosystem") {
    return s.category
      ? { title: `x402 ${CATEGORY_INFO[s.category].plural}`, alternates: { canonical: `/projects?category=${s.category}` } }
      : { title: "x402 ecosystem", alternates: { canonical: "/projects?view=ecosystem" } };
  }
  const about = topic(s.topic);
  if (s.q) return { title: `“${s.q}”`, alternates: { canonical: "/projects" } };
  if (about) return { title: `${about.label}: x402 APIs`, alternates: { canonical: `/projects?topic=${about.id}` } };
  return { title: "Explore APIs", alternates: { canonical: "/projects" } };
}

const SORT_LABELS: Record<Sort, string> = {
  relevance: "Relevance",
  popular: "Most used",
  new: "Newest",
  price: "Cheapest",
  name: "A–Z",
};

export default async function ProjectsPage({ searchParams }: Props) {
  const s = readState(await searchParams);
  // The Autonomo strip leads the first page of the plain list, and of the Robinhood Chain list.
  const showStrip =
    s.view === "apis" && !s.q && !s.topic && !s.price && (s.page ?? 1) === 1 && (!s.network || s.network === TOKEN.network);
  const [result, stats, liveFacets, allFacets, autonomoApis, records] = await Promise.all([
    s.view === "autonomo" ? null : searchProjects(searchFor(s)),
    getStats(),
    getDirectoryFacets(true),
    s.all ? getDirectoryFacets(false) : null,
    // A failed read only hides the strip and the tab, so the directory still renders.
    listAutonomoGateways().catch(() => [] as AutonomoApi[]),
    showStrip ? getTrackRecords().catch(() => null) : Promise.resolve(null),
  ]);
  const facets = allFacets ?? liveFacets;
  const ecosystemCount = ECOSYSTEM.reduce((sum, c) => sum + (stats.categories[c] ?? 0), 0);
  const about = topic(s.topic);

  const title =
    s.view === "autonomo"
      ? "Autonomo APIs"
      : s.view === "ecosystem"
        ? s.category
          ? CATEGORY_INFO[s.category].plural
          : "x402 ecosystem"
        : s.q
          ? "Search results"
          : about
            ? about.label
            : "Explore x402 APIs";

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <header>
        <p className="font-mono text-xs tracking-wide text-accent uppercase">Directory</p>
        <h1 className="heading mt-2 text-4xl sm:text-5xl">{title}</h1>
        {s.view === "autonomo" ? (
          <p className="mt-3 max-w-2xl text-muted">
            Autonomo&apos;s gateways: pay per call in USDG or {TOKEN.symbol} on {TOKEN.chainName}
            {baseCoverage() !== "none" ? ", or USDC on Base" : ""}, no account or key. The ones marked On-chain read{" "}
            {TOKEN.chainName} directly{baseCoverage() !== "none" ? ", and most read Base too" : ""}.
          </p>
        ) : s.view === "ecosystem" ? (
          <p className="mt-3 max-w-2xl text-muted">
            What x402 runs on and what is built around it: the facilitators that settle payments, the SDKs for adding
            x402 to an app, and the extensions, tools and explorers.
          </p>
        ) : (
          <p className="mt-3 max-w-2xl text-muted">
            {compact(stats.projects)} projects and {compact(stats.endpoints)} paid endpoints across {stats.networks.length}{" "}
            chains, with {compact(stats.calls30d)} paid calls in the last 30 days. From the Coinbase CDP and PayAI
            catalogs, plus every API launched on Autonomo.
          </p>
        )}

        {s.view !== "autonomo" && (
          <form action="/projects" role="search" className="mt-6 flex max-w-2xl gap-2">
            {s.view === "ecosystem" && !s.category && <input type="hidden" name="view" value="ecosystem" />}
            {s.category && <input type="hidden" name="category" value={s.category} />}
            {s.network && <input type="hidden" name="network" value={s.network} />}
            {s.topic && <input type="hidden" name="topic" value={s.topic} />}
            {s.price && <input type="hidden" name="price" value={s.price} />}
            {s.all && <input type="hidden" name="all" value="1" />}
            <input
              name="q"
              type="search"
              defaultValue={s.q}
              placeholder={s.view === "ecosystem" ? "Search facilitators, SDKs and tools" : "Search APIs, hosts or tags"}
              aria-label="Search the directory"
              className="field flex-1 py-2.5 text-base"
            />
            <button type="submit" className="btn-brand px-4 text-sm">
              Search
            </button>
          </form>
        )}

        <nav aria-label="Directory" className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-1 border-b border-line text-sm whitespace-nowrap">
            <Tab active={s.view === "apis"} href={href({ view: "apis", all: s.all })} label="All APIs" count={facets.total} />
            {autonomoApis.length > 0 && (
              <Tab active={s.view === "autonomo"} href={AUTONOMO_VIEW} label="Autonomo" count={autonomoApis.length} />
            )}
            {ecosystemCount > 0 && (
              <Tab active={s.view === "ecosystem"} href={href({ view: "ecosystem" })} label="Ecosystem" count={ecosystemCount} />
            )}
          </ul>
        </nav>
      </header>

      {s.view === "autonomo" && <AutonomoShelves apis={autonomoApis} />}

      {s.view === "ecosystem" && result && (
        <>
          <ul className="mt-6 flex flex-wrap gap-1.5 text-sm">
            <Chip active={!s.category} href={href({ view: "ecosystem", q: s.q })} label="All" count={ecosystemCount} />
            {ECOSYSTEM.filter((c) => stats.categories[c]).map((c) => (
              <Chip
                key={c}
                active={s.category === c}
                href={href({ view: "ecosystem", q: s.q, category: c })}
                label={CATEGORY_INFO[c].plural}
                count={stats.categories[c] ?? 0}
              />
            ))}
          </ul>
          <section className="mt-6">
            <Results
              s={s}
              result={result}
              sorts={s.q ? ["relevance", "popular", "new", "name"] : ["popular", "new", "name"]}
              summary={
                <>
                  <Count n={result.total} /> {result.total === 1 ? "project" : "projects"}
                  {s.q && <> for “{s.q}”</>}
                </>
              }
              clear={s.q ? href({ view: "ecosystem", category: s.category }) : undefined}
            />
          </section>
        </>
      )}

      {s.view === "apis" && result && (
        <>
          {showStrip && autonomoApis.length > 0 && (
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
                {mostPaid(autonomoApis, records, STRIP_SIZE).map((g, i) => (
                  // Two cards on phones, so the list still starts near the top; all four from tablet width.
                  <ApiCard key={g.slug} g={g} className={i >= 2 ? "max-sm:hidden" : ""} />
                ))}
              </ul>
            </section>
          )}

          <div className="mt-8 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <aside className="hidden text-sm lg:block">
              <Filters s={s} facets={facets} liveTotal={liveFacets.total} />
            </aside>
            <section className="min-w-0">
              <Results
                s={s}
                result={result}
                sorts={s.q ? ["relevance", "popular", "new", "price", "name"] : ["popular", "new", "price", "name"]}
                before={
                  <FilterSheet count={[!s.all, s.topic, s.network, s.price].filter(Boolean).length}>
                    <Filters s={s} facets={facets} liveTotal={liveFacets.total} />
                  </FilterSheet>
                }
                summary={
                  <>
                    <Count n={result.total} /> {result.total === 1 ? "API" : "APIs"}
                    {!s.all && <> with a paid call in the last 30 days</>}
                    {about && <> in {about.label}</>}
                    {s.network && <> on {networkLabel(s.network)}</>}
                    {priceBand(s.price) && <>, {priceBand(s.price)!.label.toLowerCase()} a call</>}
                    {s.q && <> for “{s.q}”</>}
                  </>
                }
                clear={s.q || s.topic || s.network || s.price || s.all ? "/projects" : undefined}
                after={
                  s.q &&
                  !s.all && (
                    <p className="mt-4 text-sm text-muted">
                      Not here? Search <Link href={href({ ...s, page: undefined, all: true })} className="underline hover:text-ink">all {(stats.categories.service ?? 0).toLocaleString("en")} paid services</Link>
                      {ecosystemCount > 0 && (
                        <>
                          {" "}
                          or <Link href={href({ view: "ecosystem", q: s.q })} className="underline hover:text-ink">the ecosystem</Link>
                        </>
                      )}
                      .
                    </p>
                  )
                }
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** The Autonomo tab: every Autonomo API on its shelf. */
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

/** The filters of the "All APIs" tab. Each is a link, so a filter works without scripts and has its own address. */
function Filters({ s, facets, liveTotal }: { s: State; facets: DirectoryFacets; liveTotal: number }) {
  // Picking a filter that's already on turns it off.
  const to = (patch: Partial<State>) => href({ ...s, page: undefined, ...patch });
  const topics = [...TOPICS].sort((a, b) => (facets.topics[b.id] ?? 0) - (facets.topics[a.id] ?? 0));
  const top = facets.networks.filter((n, i) => i < TOP_NETWORKS || n.network === TOKEN.network);
  const more = facets.networks.filter((n) => !top.includes(n));

  return (
    <div className="space-y-6">
      <FilterGroup title="Activity">
        <Option active={!s.all} href={to({ all: s.all ? undefined : true })} label="Paid calls in the last 30 days" count={liveTotal} />
      </FilterGroup>
      <FilterGroup title="Topic">
        {topics.map((t) => (
          <Option key={t.id} active={s.topic === t.id} href={to({ topic: s.topic === t.id ? undefined : t.id })} label={t.label} count={facets.topics[t.id] ?? 0} />
        ))}
      </FilterGroup>
      <div>
        <FilterGroup title="Chain">
          {top.map((n) => (
            <Option key={n.network} active={s.network === n.network} href={to({ network: s.network === n.network ? undefined : n.network })} label={networkLabel(n.network)} count={n.count} />
          ))}
        </FilterGroup>
        {more.length > 0 && (
          <details className="mt-1" open={more.some((n) => n.network === s.network)}>
            <summary className="cursor-pointer py-1 text-muted hover:text-ink">{more.length} more chains</summary>
            <ul>
              {more.map((n) => (
                <Option key={n.network} active={s.network === n.network} href={to({ network: s.network === n.network ? undefined : n.network })} label={networkLabel(n.network)} count={n.count} />
              ))}
            </ul>
          </details>
        )}
      </div>
      <FilterGroup title="Price per call">
        {PRICE_BANDS.map((b) => (
          <Option key={b.id} active={s.price === b.id} href={to({ price: s.price === b.id ? undefined : b.id })} label={b.label} count={facets.prices[b.id] ?? 0} />
        ))}
      </FilterGroup>
      <p className="text-xs text-faint">An API can be in several topics and take payment on several chains, so the counts overlap.</p>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-1.5 text-xs font-medium tracking-wide text-faint uppercase">{title}</h2>
      <ul>{children}</ul>
    </div>
  );
}

/** One filter choice, drawn as a tick box with how many APIs it holds. */
function Option({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <li>
      <Link href={href} aria-current={active ? "true" : undefined} className={`flex items-center gap-2 py-1 ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
        <span aria-hidden className={`grid size-3.5 shrink-0 place-items-center rounded-sm border ${active ? "border-brand bg-brand text-on-brand" : "border-faint"}`}>
          {active && (
            <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m2.5 6.5 2.5 2.5 4.5-5.5" />
            </svg>
          )}
        </span>
        <span className="min-w-0 flex-1">{label}</span>
        <span className="font-mono text-xs text-faint">{count.toLocaleString("en")}</span>
      </Link>
    </li>
  );
}

type SearchResult = Awaited<ReturnType<typeof searchProjects>>;

const Count = ({ n }: { n: number }) => <span className="font-mono font-medium text-ink">{n.toLocaleString("en")}</span>;

/** A list of projects with what it shows, its sorting and its pages. */
function Results({
  s,
  result,
  sorts,
  summary,
  clear,
  before,
  after,
}: {
  s: State;
  result: SearchResult;
  sorts: Sort[];
  summary: React.ReactNode;
  /** Where "Clear filters" goes, when there is something to clear. */
  clear?: string;
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {before}
          <p className="text-sm text-muted">
            {summary}
            {clear && (
              <>
                {" · "}
                <Link href={clear} className="underline hover:text-ink">
                  Clear filters
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-sm">
          {sorts.map((sort) => (
            <Link
              key={sort}
              href={href({ ...s, page: undefined, sort })}
              aria-current={result.sort === sort ? "true" : undefined}
              className={`rounded-md px-2.5 py-1 ${result.sort === sort ? "bg-ink text-bg" : "text-muted hover:bg-surface"}`}
            >
              {SORT_LABELS[sort]}
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
            <Link href={clear ?? "/projects"} className="underline">Clear filters</Link> or{" "}
            <Link href="/dashboard" className="underline">launch your API</Link>.
          </p>
        </div>
      )}
      {after}

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
          {result.page > 1 ? (
            <Link href={href({ ...s, page: result.page - 1 })} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface">
              ← Previous
            </Link>
          ) : <span />}
          <span className="text-faint">
            Page <span className="font-mono">{result.page}</span> of <span className="font-mono">{pages.toLocaleString("en")}</span>
          </span>
          {result.page < pages ? (
            <Link href={href({ ...s, page: result.page + 1 })} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface">
              Next →
            </Link>
          ) : <span />}
        </nav>
      )}
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
        {count !== undefined && <span className="font-mono text-xs text-faint">{count.toLocaleString("en")}</span>}
      </Link>
    </li>
  );
}

/** A kind of project on the Ecosystem tab. */
function Chip({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
          active ? "border-ink font-medium text-ink" : "border-line text-muted hover:text-ink"
        }`}
      >
        {label}
        <span className="font-mono text-xs text-faint">{count}</span>
      </Link>
    </li>
  );
}
