import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES } from "@/db/schema";
import { CATEGORY_INFO } from "@/lib/categories";
import { TOKEN } from "@/lib/constants";
import { formatUsd, networkLabel } from "@/lib/networks";
import {
  getStats,
  listAutonomoGateways,
  parseProjectQuery,
  searchProjects,
  type ProjectQuery,
  type Sort,
} from "@/lib/queries";
import { Avatar, compact, ProjectList } from "@/components/project-row";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseProjectQuery(await searchParams);
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
  const query = parseProjectQuery(await searchParams);
  // Autonomo's own APIs lead the first page of the plain list, and the paid-services and Robinhood Chain views.
  const showAutonomo =
    !query.q &&
    (query.page ?? 1) === 1 &&
    (!query.category || query.category === "service") &&
    (!query.network || query.network === TOKEN.network);
  const [result, stats, autonomoApis] = await Promise.all([
    searchProjects(query),
    getStats(),
    // A failed read only hides the strip, so the directory still renders.
    showAutonomo ? listAutonomoGateways().catch(() => []) : Promise.resolve([]),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const sorts: Sort[] = query.q ? ["relevance", "popular", "new", "price", "name"] : ["popular", "new", "price", "name"];
  const filtered = !!(query.q || query.category || query.network);

  const title = query.category ? CATEGORY_INFO[query.category].plural : query.q ? "Search results" : "Explore x402 APIs";
  const topNetworks = stats.networks.slice(0, TOP_NETWORKS);
  const moreNetworks = stats.networks.slice(TOP_NETWORKS);
  const activeInMore = moreNetworks.some((n) => n.network === query.network);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <header>
        <p className="font-mono text-xs tracking-wide text-accent uppercase">Directory</p>
        <h1 className="heading mt-2 text-4xl sm:text-5xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-muted">
          {compact(stats.projects)} projects and {compact(stats.endpoints)} paid endpoints across{" "}
          {stats.networks.length} chains, with {compact(stats.calls30d)} paid calls in the last 30 days. From the
          Coinbase CDP and PayAI catalogs.
        </p>

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
            <Tab active={!query.category} href={href(query, { category: undefined })} label="All" />
            {CATEGORIES.filter((c) => stats.categories[c]).map((c) => (
              <Tab
                key={c}
                active={query.category === c}
                href={href(query, { category: c })}
                label={CATEGORY_INFO[c].plural}
                count={stats.categories[c]}
              />
            ))}
          </ul>
        </nav>
      </header>

      {autonomoApis.length > 0 && (
        <section className="mt-8 rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="heading text-xl">Pay with Autonomo</h2>
            <Link href="/numbers" className="text-sm text-muted hover:text-ink">
              See how they perform →
            </Link>
          </div>
          <p className="mt-1 text-sm text-muted">
            Autonomo&apos;s own gateways on {TOKEN.chainName}: pay per call in USDG or {TOKEN.symbol}, no account or key.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {autonomoApis.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/projects/${g.projectSlug}`}
                  className="flex h-full gap-3 rounded-md border border-line bg-bg p-3 hover:border-faint"
                >
                  <Avatar name={g.name} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{g.name}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{g.description}</span>
                    <span className="mt-1.5 block font-mono text-xs">
                      {g.acceptUsdg ? `${formatUsd(g.priceUsd)} USDG` : ""}
                      {g.acceptUsdg && g.autonomoAmount ? " · " : ""}
                      {g.autonomoAmount ? `${Number(g.autonomoAmount).toLocaleString("en")} ${TOKEN.symbol}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[12rem_1fr]">
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
              <span className="font-mono text-ink">{result.total.toLocaleString("en")}</span>{" "}
              {result.total === 1 ? "result" : "results"}
              {query.network && <> on {networkLabel(query.network)}</>}
              {query.q && <> for “{query.q}”</>}
              {filtered && (
                <>
                  {" · "}
                  <Link href="/projects" className="underline hover:text-ink">Clear</Link>
                </>
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
    </div>
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
