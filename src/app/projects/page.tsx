import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES } from "@/db/schema";
import { CATEGORY_INFO } from "@/lib/categories";
import { networkLabel } from "@/lib/networks";
import { getStats, parseProjectQuery, searchProjects, type ProjectQuery, type Sort } from "@/lib/queries";
import { ProjectList } from "@/components/project-row";

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
  const [result, stats] = await Promise.all([searchProjects(query), getStats()]);
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const sorts: Sort[] = query.q ? ["relevance", "popular", "new", "price", "name"] : ["popular", "new", "price", "name"];

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 sm:px-6 lg:grid-cols-[13rem_1fr]">
      <aside className="space-y-8 text-sm">
        <form action="/projects" className="space-y-2">
          {query.category && <input type="hidden" name="category" value={query.category} />}
          {query.network && <input type="hidden" name="network" value={query.network} />}
          <input name="q" type="search" defaultValue={query.q} placeholder="Search…" aria-label="Search" className="field" />
        </form>
        <div>
          <h2 className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">Category</h2>
          <ul className="space-y-0.5">
            <FilterLink active={!query.category} href={href(query, { category: undefined })} label="All" />
            {CATEGORIES.filter((c) => stats.categories[c]).map((c) => (
              <FilterLink
                key={c}
                active={query.category === c}
                href={href(query, { category: c })}
                label={CATEGORY_INFO[c].plural}
                count={stats.categories[c]}
              />
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">Network</h2>
          <ul className="space-y-0.5">
            <FilterLink active={!query.network} href={href(query, { network: undefined })} label="Any" />
            {stats.networks.map((n) => (
              <FilterLink
                key={n.network}
                active={query.network === n.network}
                href={href(query, { network: n.network })}
                label={networkLabel(n.network)}
                count={n.count}
              />
            ))}
          </ul>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="heading text-3xl">
            {query.category ? CATEGORY_INFO[query.category].plural : "All projects"}
            {query.network && <span className="text-muted"> on {networkLabel(query.network)}</span>}
            {query.q && <span className="text-muted"> matching “{query.q}”</span>}
          </h1>
          <span className="font-mono text-sm text-muted">{result.total.toLocaleString("en")} results</span>
        </div>
        <div className="mb-4 flex flex-wrap gap-1 text-sm">
          {sorts.map((s) => (
            <Link
              key={s}
              href={href(query, { sort: s })}
              className={`rounded-md px-2.5 py-1 ${result.sort === s ? "bg-ink text-bg" : "text-muted hover:bg-surface"}`}
            >
              {SORT_LABELS[s]}
            </Link>
          ))}
        </div>

        {result.rows.length ? (
          <ProjectList rows={result.rows} />
        ) : (
          <div className="rounded-lg border border-dashed border-line p-10 text-center text-muted">
            <p>Nothing matches these filters.</p>
            <p className="mt-2 text-sm">
              <Link href="/projects" className="underline">Clear filters</Link> or{" "}
              <Link href="/submit" className="underline">launch your API</Link>.
            </p>
          </div>
        )}

        {pages > 1 && (
          <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
            {result.page > 1 ? (
              <Link href={href(query, { page: result.page - 1 })} className="text-muted hover:text-ink">← Previous</Link>
            ) : <span />}
            <span className="font-mono text-faint">
              {result.page} / {pages}
            </span>
            {result.page < pages ? (
              <Link href={href(query, { page: result.page + 1 })} className="text-muted hover:text-ink">Next →</Link>
            ) : <span />}
          </nav>
        )}
      </section>
    </div>
  );
}

function FilterLink({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex justify-between rounded px-2 py-1 ${active ? "bg-surface font-medium text-ink" : "text-muted hover:text-ink"}`}
      >
        <span>{label}</span>
        {count !== undefined && <span className="font-mono text-xs text-faint">{count}</span>}
      </Link>
    </li>
  );
}
