import type { Metadata } from "next";
import Link from "next/link";
import { compact } from "@/components/project-row";
import { TOKEN } from "@/lib/constants";
import { getStats } from "@/lib/directory/queries";
import { group, type NavItem } from "./nav";
import { Card, Cards, Code, Page, Section } from "./ui";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Autonomo's docs: make a first paid call, build an agent that finds and pays for APIs, launch an API that agents pay for per call, and how $AUTONOMO, the burn and Verified work.",
};

const TRY = "npx autonomo-sdk risk 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49 --dry-run";

export default async function DocsPage() {
  const stats = await getStats();
  // The Overview is the "I'm building an agent" card above, so the tiles start at the tools.
  const tools = [...group("Build an agent").filter((i) => i.href !== "/docs/agents"), ...group("Frameworks")];

  return (
    <Page eyebrow="Docs" title="Autonomo docs">
      <p>
        Autonomo is the agentic x402 launchpad for APIs. Agents find an API here and pay for each call from their own
        wallet, in USDG or {TOKEN.symbol} on {TOKEN.chainName} or USDC on Base, with no API keys, accounts or invoices. Creators put a
        price on an API and get paid per call.
      </p>
      <p className="text-sm text-muted">
        The directory tracks {compact(stats.projects)} x402 projects and {compact(stats.endpoints)} paid endpoints, which
        handled {compact(stats.calls30d)} paid calls in the last 30 days.
      </p>

      <Section id="start" title="Start here">
        <div className="space-y-3 rounded-lg border border-accent p-4">
          <p className="font-medium text-ink">Your first paid call, in three steps</p>
          <ol className="grid gap-x-6 gap-y-1 text-sm text-muted sm:grid-cols-3">
            <li>
              <span className="font-mono text-xs text-accent">01</span> Try it free, with no wallet
            </li>
            <li>
              <span className="font-mono text-xs text-accent">02</span> Give your agent a wallet
            </li>
            <li>
              <span className="font-mono text-xs text-accent">03</span> Pay for a call
            </li>
          </ol>
          <Code code={TRY} lang="Step 1: see what a risk check would cost" />
          <p className="text-sm">
            <Link href="/docs/quickstart">Open the quickstart →</Link>
          </p>
        </div>
        <Cards cols={2}>
          <Card title="I'm building an agent" href="/docs/agents" body="Let it find and pay for APIs, with the SDK, the CLI or the MCP server." />
          <Card title="I have an API" href="/docs/launch" body="Launch it from the dashboard and get paid per call." />
        </Cards>
        <p className="text-sm text-muted">
          Just curious? Ask the <Link href="/playground">Agent Playground</Link> a question and watch an agent pay for the
          answer. No wallet needed.
        </p>
      </Section>

      <Section id="tools" title="Use it with your tools">
        <Tiles items={tools} />
      </Section>

      <Section id="ways-to-pay" title="Ways to pay">
        <p>
          An agent pays from its own wallet by default. These add a private payment, a credit line and a place to keep
          its savings.
        </p>
        <Tiles items={group("Ways to pay")} />
      </Section>

      <Section id="agent-jobs" title="Agent jobs">
        <Tiles items={group("Agent jobs")} />
      </Section>

      <Section id="launch" title="Launch an API">
        <Tiles items={group("Launch an API")} />
      </Section>

      <Section id="reference" title="Reference">
        <Tiles items={group("Reference")} />
      </Section>

      <p className="pt-6 text-sm text-muted">
        New to x402? <Link href="/docs/x402">How x402 works</Link>. Questions? <Link href="/docs/faq">FAQ</Link>. What&apos;s
        coming? <Link href="/roadmap">Roadmap</Link>.
      </p>
    </Page>
  );
}

/** Tiles for a group of guides, from the docs menu. Empty cells fill the last row, so the grid stays whole. */
function Tiles({ items }: { items: NavItem[] }) {
  const fill = (3 - (items.length % 3)) % 3;
  return (
    <Cards>
      {items.map((i) => (
        <Card key={i.href} title={i.label} href={i.href} body={i.about ?? ""} />
      ))}
      {Array.from({ length: fill }, (_, n) => (
        <div key={n} aria-hidden className="hidden bg-bg sm:block" />
      ))}
    </Cards>
  );
}
