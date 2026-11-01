import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_INFO } from "@/lib/categories";
import { formatUsd, networkLabel } from "@/lib/networks";
import { getProject, getVerifiedGateways } from "@/lib/queries";
import { VerifiedBadge } from "@/components/verified";
import { compact, NetworkChips } from "@/components/project-row";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getProject((await params).slug);
  if (!data) return {};
  const { project } = data;
  return {
    title: project.name,
    description: project.description || `${project.name}: x402 ${CATEGORY_INFO[project.category].label.toLowerCase()}`,
    alternates: { canonical: `/projects/${project.slug}` },
  };
}

const FACILITATOR_LABELS: Record<string, string> = { cdp: "Coinbase CDP", payai: "PayAI" };

export default async function ProjectPage({ params }: Props) {
  const data = await getProject((await params).slug);
  if (!data) notFound();
  const { project: p, endpoints } = data;
  const { projectSlugs } = await getVerifiedGateways();

  const links = [
    { label: "Website", url: p.website },
    { label: "Docs", url: p.docs },
    { label: "GitHub", url: p.github },
    { label: "X", url: p.twitter ? `https://x.com/${p.twitter.replace(/^@/, "")}` : null },
  ].filter((l): l is { label: string; url: string } => !!l.url);

  return (
    <article className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <nav className="text-sm text-muted">
        <Link href="/projects" className="hover:text-ink">Explore</Link>
        <span className="mx-2 text-faint">/</span>
        <Link href={`/projects?category=${p.category}`} className="hover:text-ink">
          {CATEGORY_INFO[p.category].plural}
        </Link>
      </nav>

      <header className="mt-6 grid gap-8 border-b border-line pb-8 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <h1 className="heading text-4xl normal-case sm:text-5xl">{p.name}</h1>
          {projectSlugs.includes(p.slug) && (
            <p className="mt-2">
              <VerifiedBadge />
            </p>
          )}
          {p.host && <p className="mt-1 font-mono text-sm text-faint">{p.host}</p>}
          {p.description && <p className="mt-4 max-w-2xl text-lg text-muted">{p.description}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface"
              >
                {l.label} ↗
              </a>
            ))}
          </div>
          {p.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <Link key={t} href={`/projects?q=${encodeURIComponent(t)}`} className="text-sm text-muted hover:text-ink">
                  #{t}
                </Link>
              ))}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-4 self-start text-sm lg:grid-cols-1">
          <Fact label="Category" value={CATEGORY_INFO[p.category].label} />
          {p.networks.length > 0 && <Fact label="Networks" value={<NetworkChips networks={p.networks} max={8} />} />}
          {p.endpointCount > 0 && (
            <>
              <Fact label="Starting price" value={<span className="font-mono">{formatUsd(p.minPriceUsd)}</span>} />
              <Fact label="Paid calls, 30 days" value={<span className="font-mono">{compact(p.calls30d)}</span>} />
            </>
          )}
        </dl>
      </header>

      {endpoints.length > 0 && (
        <section className="mt-10">
          <h2 className="heading mb-1 text-xl">Paid endpoints</h2>
          <p className="mb-4 text-sm text-muted">
            {endpoints.length === p.endpointCount
              ? `${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}`
              : `Top ${endpoints.length} of ${p.endpointCount} endpoints`}
            , sorted by usage. Prices are per request.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Endpoint</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 font-medium">Network</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Facilitator</th>
                  <th className="px-4 py-2 text-right font-medium">Calls / 30d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {endpoints.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="max-w-md px-4 py-3">
                      <div className="flex items-baseline gap-2 font-mono text-xs">
                        <span className="shrink-0 text-accent">{e.method}</span>
                        <span className="break-all">{pathOf(e.url, p.host)}</span>
                      </div>
                      {e.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{e.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap">{formatUsd(e.priceUsd)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{e.network ? networkLabel(e.network) : "—"}</td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">
                      {FACILITATOR_LABELS[e.facilitator] ?? e.facilitator}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{compact(e.calls30d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-10 text-sm text-faint">
        Is this your project?{" "}
        <Link href={`/submit?claim=${p.slug}`} className="underline hover:text-ink">
          Suggest an edit
        </Link>
        .
      </p>
    </article>
  );
}

function pathOf(url: string, host: string | null) {
  try {
    const u = new URL(url);
    return host && u.hostname === host ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
