import type { Metadata } from "next";
import Link from "next/link";
import { compact } from "@/components/project-row";
import { BURN_BPS, burnFactory } from "@/lib/burn";
import { TOKEN } from "@/lib/constants";
import { getStats, listAutonomoGateways } from "@/lib/queries";
import { Card, Cards, Faq, Page, Section } from "./ui";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How Autonomo works: launch an API that AI agents pay for per call, use Autonomo's APIs from your agent, and how $AUTONOMO, the burn and Verified work.",
};

// Where Autonomo is. Update `status` as phases ship; "live" items are things anyone can use today.
// In the phase being built, items with `now: true` are in progress, `done: true` are complete, the rest are up next.
type Item = { title: string; note?: string; now?: boolean; done?: boolean };
type Phase = { name: string; status: "live" | "building" | "next" | "later"; summary?: string; items: Item[] };
const ROADMAP: Phase[] = [
  {
    name: "Phase 1",
    status: "live",
    items: [
      { title: "Hosted x402 gateways for any API", note: "Launch from the dashboard, get paid per call" },
      { title: "Pay per call in USDG or $AUTONOMO", note: "On Robinhood Chain, settled by Autonomo's own facilitator" },
      { title: "Owner dashboard and on-chain receipts", note: "Paid calls, earnings and tx links" },
      { title: "AI agents paying live", note: "Codex demo and the agent payment example" },
      { title: "Agent Playground", note: "Ask a question, watch an agent pay in $AUTONOMO" },
      { title: "Official Autonomo APIs", note: "Token Price, New Launches and Risk Checker" },
    ],
  },
  {
    name: "Phase 2",
    status: "building",
    summary:
      "the Telegram bot, the Autonomo MCP server and Verified are complete, more official APIs are in progress, and the Agent SDK and CLI are up next",
    items: [
      { title: "Autonomo agent bot for Telegram", note: "Live at t.me/autonomoagentbot: ask in a DM or a group, with free daily answers", done: true },
      {
        title: "More official APIs",
        note: "Live now: Token Price, New Launches, Risk Checker, Token Lookup, Tx Explainer, Wallet Portfolio and Page Reader. More on the way",
        now: true,
      },
      {
        title: "Autonomo MCP server",
        note: "On npm as autonomo-mcp: Claude, Cursor, Codex and other agents find and pay APIs natively",
        done: true,
      },
      { title: "Verified for API providers", note: "Launching stays free. Hold $AUTONOMO and your APIs show as Verified", done: true },
      { title: "Agent SDK and CLI", note: "With spend limits built in" },
      { title: "Webhooks and payout analytics", note: "For API owners" },
    ],
  },
  {
    name: "Later",
    status: "later",
    items: [
      { title: "Base and Solana support", note: "Launch and pay for APIs on more chains, beyond Robinhood Chain" },
      { title: "APIs from other platforms", note: "The agent uses and pays x402 APIs from platforms like PayAI and Coinbase" },
      { title: "API reputation" },
    ],
  },
];

const PHASE_STYLE: Record<Phase["status"], { label: string; className: string }> = {
  live: { label: "Live", className: "bg-brand text-on-brand" },
  building: { label: "Building now", className: "border border-accent text-accent" },
  next: { label: "Next", className: "border border-line text-muted" },
  later: { label: "Later", className: "border border-line text-faint" },
};

const FAQ: [string, React.ReactNode][] = [
  [
    "Does Autonomo take a cut of payments?",
    burnFactory() ? (
      <>Autonomo keeps none of it, but <Link href="/docs/token#burn">{BURN_BPS / 100}% of each payment is burned</Link>. On hosted gateways, payments go from the agent&apos;s wallet to your own splitter contract and wait there until it&apos;s flushed, which happens when it reaches 1,000 {TOKEN.symbol} or 0.10 USDG, or otherwise once a day if it holds at least 100 {TOKEN.symbol}. Flushing sends {100 - BURN_BPS / 100}% to your <code>payTo</code> wallet and burns the rest. Nobody can take the money out of a splitter any other way, and anyone can flush one. Autonomo&apos;s facilitator settles each payment on-chain and pays the gas. Autonomo is only paid for its own <Link href="/docs/official-apis">official APIs</Link>.</>
    ) : (
      <>No. Payments go straight from the agent&apos;s wallet to your <code>payTo</code> wallet. For hosted gateways, Autonomo&apos;s facilitator settles the payment on-chain and pays the gas, but never holds the money. Autonomo is only paid for its own <Link href="/docs/official-apis">official APIs</Link>.</>
    ),
  ],
  [
    "Does Autonomo host my API?",
    <>No. Your API runs wherever it runs today. A <Link href="/docs/launch">hosted gateway</Link> sits in front of it, takes the payment and forwards the request; or you <Link href="/docs/self-hosted">run x402 yourself</Link> and Autonomo just lists it.</>,
  ],
  [
    "How much does it cost to launch?",
    <>Nothing. Launching a gateway and getting listed are free, whether your API comes from a facilitator catalog, the dashboard or the launch form.</>,
  ],
  [
    "Is the discovery API free?",
    <>Yes, with no key. See the <Link href="/api-docs">API reference</Link>.</>,
  ],
  [
    "Is it safe to give the MCP server a private key?",
    <>Use a new wallet just for your agent with a small balance, never your main wallet. The key stays on your computer and is only used to sign payments, the server only pays Autonomo gateways, and it stops at a per-call cap and a daily budget.</>,
  ],
  [
    "My listing is wrong or out of date. How do I fix it?",
    <>Open your project page and use <b>Suggest an edit</b>, or send the details through the <Link href="/submit">launch form</Link>. Edits are reviewed by hand.</>,
  ],
  [
    "Which networks are supported?",
    <>Hosted gateways and the official APIs take USDG or {TOKEN.symbol} on {TOKEN.chainName}. Self-hosted APIs use whatever their facilitator supports: most listed endpoints settle on Base, followed by Solana, Polygon, Arbitrum and others. Testnet-only services are hidden. Base and Solana for gateways are on the <a href="#roadmap">roadmap</a>.</>,
  ],
];

export default async function DocsPage() {
  const [stats, liveApis] = await Promise.all([getStats(), listAutonomoGateways()]);
  const current = ROADMAP.find((p) => p.status === "building");

  return (
    <Page eyebrow="Docs" title="Launch an API agents pay for">
      <p>
        Autonomo is the agentic x402 launchpad for APIs. Put a price on an API, launch it here, and AI agents find it and
        pay for each call in USDG or {TOKEN.symbol} on {TOKEN.chainName}. Agents need no API keys, accounts or invoices:
        just a wallet.
      </p>
      <p className="text-sm text-muted">
        The directory tracks {compact(stats.projects)} x402 projects and {compact(stats.endpoints)} paid endpoints, which
        handled {compact(stats.calls30d)} paid calls in the last 30 days.
      </p>

      <Section id="start" title="Start here">
        <Cards>
          <Card title="I have an API" href="/docs/launch" body="Launch it from the dashboard in minutes and get paid per call." />
          <Card title="I'm building an agent" href="/docs/agents" body="Let your agent find and pay for APIs, with the MCP server or your own code." />
          <Card title={`I hold ${TOKEN.symbol}`} href="/docs/token" body="The official address, the burn on every paid call, and Verified." />
        </Cards>
        <p>
          Just curious? Ask the <Link href="/playground">Agent Playground</Link> a question and watch an agent pay for the
          answer. No wallet needed.
        </p>
      </Section>

      <Section id="how-x402-works" title="How x402 works">
        <p>
          x402 uses the HTTP status code <code>402 Payment Required</code>. Payment happens inside a normal HTTP request:
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>The agent calls an API.</li>
          <li>
            The API answers <code>402</code> with the price, the network and the wallet to pay.
          </li>
          <li>The agent signs a payment and calls again with it attached.</li>
          <li>The payment settles on-chain and the API returns the data.</li>
        </ol>
        <p>
          Prices can be fractions of a cent, so per-call pricing works for data, AI and tools that would never justify a
          subscription.
        </p>
      </Section>

      <Section id="guides" title="Guides">
        <div className="grid gap-6 sm:grid-cols-3">
          <GuideList
            title="Launch an API"
            items={[
              ["/docs/launch", "Launch from the dashboard", "No code: a hosted gateway in front of your API."],
              ["/docs/safe", "Get paid at a Safe", "Send your earnings to a multisig."],
              ["/docs/self-hosted", "Run x402 yourself", "Add x402 to your own server and get listed."],
            ]}
          />
          <GuideList
            title="Use APIs"
            items={[
              ["/docs/directory", "The x402 directory", "What's in it, how to search it and where the data comes from."],
              ["/docs/agents", "Use Autonomo from your agent", "MCP server, your own code, Playground and Telegram."],
              ["/docs/official-apis", "Official APIs", "The APIs Autonomo runs, and the wallets behind them."],
              ["/api-docs", "API reference", "The free discovery API: every endpoint and parameter."],
            ]}
          />
          <GuideList
            title="Token"
            items={[["/docs/token", `${TOKEN.symbol}, burn and Verified`, "The address, the burn on paid calls, and the Verified badge."]]}
          />
        </div>
      </Section>

      <Section id="directory" title="The x402 directory">
        <p>
          The <Link href="/projects">directory</Link> maps the x402 ecosystem: paid APIs, facilitators, SDKs, wallets and
          tools, with each endpoint&apos;s price, network and paid calls. Search it by what you need, or let your agent
          search it through the free API. Paid services come from the Coinbase CDP and PayAI catalogs, refreshed every 3
          days. <Link href="/docs/directory">How the directory works</Link>.
        </p>
      </Section>

      <Section id="roadmap" title="Roadmap & status">
          <div className="rounded-lg border border-accent bg-surface p-4">
            <p className="font-mono text-xs tracking-wide text-accent uppercase">Live status</p>
            <p className="mt-2 text-ink">
              Phase 1 is live.{current ? <> In <b>{current.name}</b>, {current.summary ?? current.items.filter((i) => i.now).map((i) => i.title).join(" and ")}.</> : null}
            </p>
            {liveApis.length > 0 && (
              <p className="mt-2 text-sm text-muted">
                {liveApis.length} official {liveApis.length === 1 ? "API is" : "APIs are"} live and payable in {TOKEN.symbol}:{" "}
                {liveApis.map((g, i) => (
                  <span key={g.slug}>
                    {i > 0 && ", "}
                    <Link href={`/projects/${g.projectSlug}`}>{g.name}</Link>
                  </span>
                ))}
                . Try them in the <Link href="/playground">Agent Playground</Link>.
              </p>
            )}
          </div>
          <ol className="space-y-3">
            {ROADMAP.map((phase) => (
              <li key={phase.name} className="rounded-lg border border-line p-4">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium text-ink">{phase.name}</h3>
                  <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] tracking-wide uppercase ${PHASE_STYLE[phase.status].className}`}>
                    {PHASE_STYLE[phase.status].label}
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {phase.items.map((item) => {
                    const done = phase.status === "building" && item.done;
                    const active = phase.status === "building" && item.now;
                    const upNext = phase.status === "building" && !item.now && !item.done;
                    return (
                      <li
                        key={item.title}
                        className={`flex gap-2.5 ${active ? "-mx-2 rounded-md border border-accent bg-accent-soft px-2 py-1.5" : ""}`}
                      >
                        <span
                          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                            phase.status === "live" || active || done ? "bg-brand" : "bg-faint"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className={upNext ? "text-muted" : "text-ink"}>{item.title}</span>
                          {done && <span className="ml-2 rounded-sm bg-brand px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-on-brand uppercase">✓ Complete</span>}
                          {active && <span className="ml-2 font-mono text-[10px] tracking-wide text-accent uppercase">In progress</span>}
                          {upNext && <span className="ml-2 font-mono text-[10px] tracking-wide text-faint uppercase">Up next</span>}
                          {item.note && <span className="block text-sm text-muted">{item.note}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">
            Plans can change as we learn what agents and builders need. Follow along on{" "}
            <a href="https://x.com/useautonomo">X</a> and <a href="https://t.me/autonomodotfun">Telegram</a>.
          </p>
        </Section>

      <Section id="faq" title="FAQ">
        <Faq items={FAQ} />
      </Section>
    </Page>
  );
}

function GuideList({ title, items }: { title: string; items: [string, string, string][] }) {
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-faint uppercase">{title}</h3>
      <ul className="mt-2 space-y-3">
        {items.map(([href, label, about]) => (
          <li key={href}>
            <Link href={href} className="font-medium">
              {label}
            </Link>
            <span className="block text-sm text-muted">{about}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
