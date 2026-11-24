import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { baseCoverage } from "@/lib/gateway/gateway";
import { formatUsd } from "@/lib/payments/networks";
import { getStats, getTrackRecords, listAutonomoGateways, searchProjects } from "@/lib/directory/queries";
import { ApiCard, mostPaid, paidCalls, type AutonomoApi } from "@/components/api-card";
import { Avatar, compact, ProjectList } from "@/components/project-row";
import { Tabs, type TabItem } from "@/components/tabs";
import { PartnersGrid } from "@/components/partners";
import { PaymentDemo } from "@/components/payment-demo";

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

// The same three beats from the agent's side. What it says matches /docs/agents: a dedicated wallet, the MCP server or
// the SDK, and daily limits.
const AGENT_STEPS = [
  {
    title: "Give it a wallet",
    body: "Make a new wallet just for your agent and send it a little USDG or $AUTONOMO on Robinhood Chain, or USDC on Base.",
  },
  {
    title: "Connect Autonomo",
    body: "Add the MCP server to Claude, Cursor or Codex, or use the SDK. Your agent finds an API and reads its live price.",
  },
  {
    title: "It pays per call",
    body: "When an API answers 402, it pays and retries, within the daily limits you set. No API keys or accounts.",
  },
];

const PATHS = [
  { who: "For API creators", steps: LAUNCH_STEPS, cta: "Launch your API", href: "/dashboard" },
  { who: "For agents", steps: AGENT_STEPS, cta: "Connect your agent", href: "/docs/agents" },
];

const AUTONOMO_APIS = "/projects?view=autonomo";
// Rows in each of the directory's lists on this page.
const LIST_SIZE = 5;

export default async function Home() {
  const [stats, popular, newest, autonomoApis, records] = await Promise.all([
    getStats(),
    searchProjects({ category: "service", sort: "popular", limit: LIST_SIZE }),
    // Newest with a paid call already, so the list isn't led by services nobody has used yet.
    searchProjects({ category: "service", sort: "new", active: true, limit: LIST_SIZE }),
    // A failed read only hides Autonomo's own APIs, so the rest of the homepage still renders.
    listAutonomoGateways().catch(() => [] as AutonomoApi[]),
    getTrackRecords().catch(() => null),
  ]);
  const ownApis = mostPaid(autonomoApis, records, LIST_SIZE);

  // The directory's lists, one tab each. Every list ends with a link to the full one on the Explore page.
  const lists: TabItem[] = [
    {
      id: "used",
      label: "Most used",
      panel: (
        <>
          <ProjectList rows={popular.rows} />
          <SeeAll href="/projects">See all paid services by use</SeeAll>
        </>
      ),
    },
    {
      id: "new",
      label: "Newest",
      panel: (
        <>
          <ProjectList rows={newest.rows} />
          <SeeAll href="/projects?sort=new">See the newest services</SeeAll>
        </>
      ),
    },
    ...(ownApis.length
      ? [
          {
            id: "autonomo",
            label: "Autonomo APIs",
            panel: (
              <>
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-bg">
                  {ownApis.map((g) => (
                    <AutonomoRow key={g.slug} g={g} paid={paidCalls(records, g.slug)} />
                  ))}
                </ul>
                <SeeAll href={AUTONOMO_APIS}>See all {autonomoApis.length} Autonomo APIs</SeeAll>
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="grid gap-10 pt-16 pb-12 sm:pt-24 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center lg:gap-12">
        <div>
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
        </div>
        <PaymentDemo />
      </section>

      <section className="py-8">
        <SectionHead title="How it works" />
        <div className="grid gap-4 lg:grid-cols-2">
          {PATHS.map((path) => (
            <div key={path.who} className="overflow-hidden rounded-lg border border-line">
              <div className="flex items-baseline justify-between gap-3 border-b border-line bg-surface px-5 py-3">
                <h3 className="font-mono text-xs tracking-[0.14em] text-muted uppercase">{path.who}</h3>
                <Link href={path.href} className="shrink-0 text-sm text-muted hover:text-ink">
                  {path.cta} →
                </Link>
              </div>
              <ol className="divide-y divide-line">
                {path.steps.map((s, i) => (
                  <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 p-5">
                    <span className="pt-0.5 font-mono text-xs text-accent">0{i + 1}</span>
                    <div>
                      <h4 className="font-medium">{s.title}</h4>
                      <p className="mt-1 text-sm text-muted">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="py-8">
        <SectionHead title="Use with" href="/partners" />
        <PartnersGrid />
      </section>

      {ownApis.length > 0 && (
        <section className="py-8">
          <SectionHead title="Pay for these today" href={AUTONOMO_APIS} more={`All ${autonomoApis.length} Autonomo APIs`} />
          <p className="max-w-2xl text-muted">
            Autonomo&apos;s own APIs. Pay per call in USDG or {TOKEN.symbol} on {TOKEN.chainName}
            {baseCoverage() !== "none" ? ", or USDC on Base" : ""}, with no account or key.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ownApis.slice(0, 4).map((g) => (
              <ApiCard key={g.slug} g={g} />
            ))}
          </ul>
        </section>
      )}

      <section className="py-8">
        <SectionHead title="The x402 directory" href="/projects" />
        <p className="max-w-2xl text-muted">Every x402 project we can find, with live prices and usage.</p>
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
        <p className="mt-4 text-sm text-muted">
          <Num>{compact(stats.projects)}</Num> projects · <Num>{compact(stats.endpoints)}</Num> paid endpoints ·{" "}
          <Num>{compact(stats.calls30d)}</Num> paid calls in 30 days · <Num>{stats.networks.length}</Num> chains
        </p>
        <div className="mt-6">
          <Tabs label="Directory lists" tabs={lists} />
        </div>
      </section>
    </div>
  );
}

const Num = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-ink">{children}</span>;

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-3 inline-block text-sm text-muted hover:text-ink">
      {children} →
    </Link>
  );
}

/** An Autonomo API as a row of the directory's list: what a call costs and how many were paid for in 30 days. */
function AutonomoRow({ g, paid }: { g: AutonomoApi; paid: number }) {
  return (
    <li>
      <Link
        href={`/projects/${g.projectSlug}`}
        className="grid grid-cols-[auto_1fr_auto] items-start gap-x-4 px-4 py-4 hover:bg-surface sm:grid-cols-[auto_1fr_7rem_8rem]"
      >
        <Avatar name={g.name} src={g.logoUrl} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{g.name}</span>
            <span className="shrink-0 rounded border border-accent px-1.5 py-px text-[11px] font-medium text-accent">Autonomo</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted sm:line-clamp-1">{g.description}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm whitespace-nowrap">from {formatUsd(g.priceUsd)}</div>
          <div className="text-xs text-faint">a call</div>
        </div>
        <div className="hidden text-right sm:block">
          <div className={`font-mono text-sm ${paid ? "" : "text-faint"}`}>{compact(paid)}</div>
          <div className="text-xs text-faint">paid calls / 30d</div>
        </div>
      </Link>
    </li>
  );
}

function SectionHead({ title, href, more = "View all" }: { title: string; href?: string; more?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="heading text-xl">{title}</h2>
      {href && (
        <Link href={href} className="text-sm text-muted hover:text-ink">
          {more} →
        </Link>
      )}
    </div>
  );
}
