import Link from "next/link";
import { CATEGORIES } from "@/db/schema";
import { CATEGORY_INFO } from "@/lib/categories";
import { networkLabel } from "@/lib/networks";
import { getFeatured, getStats, searchProjects } from "@/lib/queries";
import { compact, ProjectList } from "@/components/project-row";
import { PartnersRow } from "@/components/partners";

const LAUNCH_STEPS = [
  {
    title: "Price your endpoint",
    body: "Add x402 middleware from an SDK. Unpaid requests get a 402 with your price, network and payTo wallet.",
  },
  {
    title: "Launch it",
    body: "Register with a Bazaar-enabled facilitator to appear automatically, or request a launch here.",
  },
  {
    title: "Agents pay per call",
    body: "Agents find you through the Autonomo API, pay in stablecoins and retry. Settlement lands in your wallet.",
  },
];

export default async function Home() {
  const [stats, popular, facilitators, sdks] = await Promise.all([
    getStats(),
    searchProjects({ category: "service", sort: "popular", limit: 10 }),
    getFeatured("facilitator", 6),
    getFeatured("sdk", 4),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="flex min-h-[calc(80svh-4.5rem)] flex-col pt-16 sm:pt-24">
        <p className="font-mono text-xs tracking-wide text-accent uppercase">The agentic x402 launchpad and directory</p>
        <h1 className="heading mt-3 max-w-3xl text-5xl leading-[0.95] text-balance sm:text-7xl">
          Launch your API. Let <span className="underline decoration-brand decoration-[0.14em] underline-offset-[0.1em]">agents</span> pay.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Put an x402 price on any endpoint and AI agents can discover it and pay per call, with no keys, accounts or
          invoices.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-brand px-5 py-2.5 text-sm">Launch your API</Link>
          <Link href="/docs/agents" className="rounded-md border border-line px-5 py-2.5 text-sm hover:bg-surface">
            Connect your agent
          </Link>
        </div>
        {/* Any spare height splits evenly above and below, so the row sits midway between the buttons and the next
            section. pb-4 plus that section's own pt-8 matches pt-12. */}
        <div className="flex flex-1 items-center pt-12 pb-4">
          <PartnersRow />
        </div>
      </section>

      <section className="py-8">
        <SectionHead title="How a launch works" />
        <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
          {LAUNCH_STEPS.map((s, i) => (
            <li key={s.title} className="bg-bg p-5">
              <span className="font-mono text-xs text-accent">0{i + 1}</span>
              <h3 className="mt-1 font-medium">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="py-8">
        <SectionHead title="The x402 directory" href="/projects" />
        <p className="max-w-2xl text-muted">
          Every x402 project we can find, on {stats.networks.length} networks, with live prices and usage.
        </p>
        <form action="/projects" className="mt-5 flex max-w-xl gap-2">
          <input
            name="q"
            type="search"
            placeholder="Search for weather, image generation, Solana data…"
            aria-label="Search projects"
            className="field h-11 flex-1 text-base"
          />
          <button className="btn-brand h-11 px-5 text-sm">Search</button>
        </form>
        <dl className="mt-8 grid max-w-2xl grid-cols-3 gap-6">
          <Stat label="Projects" value={compact(stats.projects)} />
          <Stat label="Paid endpoints" value={compact(stats.endpoints)} />
          <Stat label="Paid calls, last 30 days" value={compact(stats.calls30d)} />
        </dl>
        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.filter((c) => stats.categories[c]).map((c) => (
            <Link key={c} href={`/projects?category=${c}`} className="bg-bg p-4 hover:bg-surface">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{CATEGORY_INFO[c].plural}</span>
                <span className="font-mono text-xs text-faint">{stats.categories[c]}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{CATEGORY_INFO[c].blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="py-8">
        <SectionHead title="Most used services this month" href="/projects?category=service&sort=popular" />
        <ProjectList rows={popular.rows} />
      </section>

      <div className="grid gap-10 py-8 lg:grid-cols-2">
        <section>
          <SectionHead title="Facilitators" href="/projects?category=facilitator" />
          <ProjectList rows={facilitators} />
        </section>
        <section>
          <SectionHead title="SDKs" href="/projects?category=sdk" />
          <ProjectList rows={sdks} />
          <h3 className="mt-10 mb-3 text-sm font-medium text-muted">Networks</h3>
          <div className="flex flex-wrap gap-2">
            {stats.networks.map((n) => (
              <Link
                key={n.network}
                href={`/projects?network=${encodeURIComponent(n.network)}`}
                className="rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface"
              >
                {networkLabel(n.network)} <span className="font-mono text-xs text-faint">{n.count}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-2xl">{value}</dd>
    </div>
  );
}

function SectionHead({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="heading text-xl">{title}</h2>
      {href && (
        <Link href={href} className="text-sm text-muted hover:text-ink">
          View all →
        </Link>
      )}
    </div>
  );
}
