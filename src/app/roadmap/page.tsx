import type { Metadata } from "next";
import { bondEnabled } from "@/lib/bond";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "What Autonomo has shipped, what comes next, and what comes later for x402 APIs, agents and $AUTONOMO.",
};

// The roadmap. Move items between stages as they ship: "live" items are things anyone can use today.
// The provider bond moves itself: it is under "Coming next" until its contract is set (PROVIDER_BOND), then under Token.

const BOND: { title: string; note: string } = {
  title: "Provider bond",
  note: "Creators lock $AUTONOMO and show as Bonded. If their API takes payments and doesn't deliver, part of the bond refunds the agent and the rest is burned. Not audited yet",
};

type Item = { title: string; note?: string };
type Group = { name: string; items: Item[] };
type Stage = { name: string; status: "live" | "next" | "later"; groups?: Group[]; items?: Item[] };

const ROADMAP: Stage[] = [
  {
    name: "Shipped",
    status: "live",
    groups: [
      {
        name: "Marketplace",
        items: [
          { title: "x402 API directory", note: "5,400+ projects, with live prices, usage, logos and paid endpoints" },
          { title: "Free discovery API", note: "No key needed" },
          { title: "Launch flow for paid APIs", note: "Three short steps, a test call before launch, and several APIs at once" },
          { title: "Pay in USDG or $AUTONOMO", note: "On Robinhood Chain, settled by Autonomo's own facilitator" },
          { title: "Pay in USDC on Base", note: "Every API can take it, at the same dollar price, when its creator turns it on" },
          { title: "One price in dollars", note: "Paying in $AUTONOMO costs 20% less" },
          {
            title: "16 official APIs",
            note: "Including Risk Checker, Dev Wallet Tracker, Holders & Bundles and the Tokyo Futuro Job Finder",
          },
          { title: "Listed in Coinbase's x402 Bazaar", note: "The official APIs describe themselves to Coinbase's directory" },
          { title: "Agent Playground", note: "Free daily answers" },
          { title: "Research agent", note: "Free reports on any Robinhood Chain token, 3 a day" },
          { title: "Owner dashboard", note: "Paid calls, earnings and on-chain receipts" },
          { title: "Numbers page", note: "Paid, refused and failed calls, outside and returning payers, and speed for each official API" },
        ],
      },
      {
        name: "Agent tools",
        items: [
          { title: "MCP server", note: "Listed on the official MCP Registry" },
          { title: "SDK on npm and PyPI", note: "One call finds an API, pays for it and returns a receipt" },
          { title: "CLI", note: "npx autonomo-sdk, with spend limits, dry runs and private payments through Gloam" },
          { title: "LangChain tools", note: "For Python and TypeScript" },
          { title: "elizaOS plugin", note: "For elizaOS 1.x and 2.x, with the wallet and limits in the agent's settings" },
          { title: "Spending caps", note: "Per call and per day, and failed calls aren't charged" },
          { title: "llms.txt", note: "A plain-text map of Autonomo for AI agents" },
          { title: "Agent identity", note: "The official APIs are agent 26170 in the ERC-8004 registry on Robinhood Chain" },
          { title: "Telegram bot", note: "Ask in a DM or a group, with free daily answers" },
        ],
      },
      {
        name: "Token",
        items: [
          { title: "5% buyback and burn", note: "On every paid call through a gateway" },
          { title: "Verified contracts and a public burn page", note: "The first burn is on-chain" },
          { title: "Verified badge", note: "For API creators who hold $AUTONOMO" },
          { title: "Official APIs paid into a 2-of-2 Safe", note: "It also holds about 1M $AUTONOMO" },
          { title: "Burn on Base payments", note: "5% of Base payments still buys back and burns $AUTONOMO, on Robinhood Chain" },
          {
            title: "Rewards vesting contract",
            note: "Holds the $AUTONOMO set aside for rewards, released on a schedule from December 1, 2026 to May 30, 2027",
          },
          ...(bondEnabled() ? [BOND] : []),
        ],
      },
      {
        name: "Partners",
        items: [
          { title: "Gloam", note: "Private payments" },
          { title: "Borro", note: "Agents borrow to pay for calls" },
          { title: "Tokyo Futuro", note: "Agent jobs. The Job Finder, built with them, finds open jobs an agent can take" },
          { title: "Stoa", note: "Swap router. Token safety checks and swap quotes, run on Autonomo's gateways" },
          { title: "QHooks", note: "Token proof. QProof token checks, and a guide to keeping an agent's savings in a QWallet" },
          { title: "Raeto", note: "Agent record. The official APIs have a public record on Raeto, with statements anyone can check" },
        ],
      },
      {
        name: "Security",
        items: [
          {
            title: "Creators can get paid into a multisig Safe",
            note: "Moving the money takes more than one signature, so a single stolen key can't empty it",
          },
        ],
      },
      {
        name: "Milestones",
        items: [
          { title: "First outside agent paying on its own", note: "Minimum Viable Agent paid the Risk Checker from its own wallet on Nov 3" },
          { title: "First borrow-and-pay on-chain", note: "A test agent with no USDG borrowed through Borro and paid New Launches on Nov 6" },
          { title: "First payments in USDC on Base", note: "An agent paid official APIs in USDC on Base on Nov 18" },
        ],
      },
    ],
  },
  {
    name: "Coming next",
    status: "next",
    items: [
      { title: "More official APIs", note: "Adding to the 16 that are live today" },
      { title: "Grants for outside APIs", note: "Starting with tokenized stock data" },
      { title: "Solana payments on gateways", note: "Base is live; Solana next, with the burn still on Robinhood Chain" },
      {
        title: "Base payments in the agent tools",
        note: "The SDK, CLI, LangChain tools and elizaOS plugin pay in USDC on Base too. Today they pay on Robinhood Chain",
      },
      { title: "Token and security page", note: "Supply, team and treasury wallets, unlocks, verified splitter" },
      { title: "APIs from other platforms", note: "Coinbase and PayAI APIs, usable through the SDK" },
      { title: "Webhooks and payout analytics", note: "For API owners" },
      { title: "Free daily calls for holders", note: "On the official APIs" },
      ...(bondEnabled() ? [] : [BOND]),
    ],
  },
  {
    name: "Later",
    status: "later",
    items: [
      { title: "API reputation score", note: "Uptime, success rate and real payers, with an open formula and no paid placement" },
      { title: "Router", note: "One endpoint per need, the best provider picked automatically, fallback if one fails, payment only for valid answers" },
      { title: "Bond audit and Router rules", note: "An outside audit of the bond contract, and the Router skips an API for 30 days after a slash" },
      { title: "Verifier network", note: "Anyone stakes $AUTONOMO to check API quality" },
      { title: "ZK private payments", note: "Private for the agent, with public proof" },
    ],
  },
];

const STATUS_STYLE: Record<Stage["status"], { label: string; className: string; line: string; card: string }> = {
  live: { label: "Live", className: "bg-brand text-on-brand", line: "Live today. Anyone can use these.", card: "border-accent" },
  next: { label: "Next", className: "border border-accent text-accent", line: "What we're building after this.", card: "border-line" },
  later: { label: "Later", className: "border border-line text-faint", line: "Bigger bets, once the basics are in place.", card: "border-line" },
};

const countItems = (s: Stage) => (s.items?.length ?? 0) + (s.groups ?? []).reduce((n, g) => n + g.items.length, 0);

function Items({ items, status }: { items: Item[]; status: Stage["status"] }) {
  return (
    // Divided rows: title on the left, note on the right; on phones the note sits under the title.
    <ul className="divide-y divide-line border-t border-line">
      {items.map((item) => (
        <li key={item.title} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <span className={status === "later" ? "text-muted" : "text-ink"}>{item.title}</span>
          {item.note && <span className="text-sm text-muted sm:pt-px">{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">Roadmap</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">Roadmap &amp; status</h1>
      <p className="mt-4 text-muted">What&apos;s live today, what comes next, and what comes after that. Updated November 21, 2026.</p>

      <ol className="mt-8 space-y-3">
        {ROADMAP.map((stage) => (
          <li key={stage.name} className={`rounded-lg border p-4 ${STATUS_STYLE[stage.status].card}`}>
            <div className="flex items-center gap-3">
              <h2 className="font-medium text-ink">{stage.name}</h2>
              <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] tracking-wide uppercase ${STATUS_STYLE[stage.status].className}`}>
                {STATUS_STYLE[stage.status].label}
              </span>
              <span className="ml-auto font-mono text-xs text-faint">{countItems(stage)} items</span>
            </div>
            <p className="mt-1 text-sm text-muted">{STATUS_STYLE[stage.status].line}</p>
            {stage.groups && (
              <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {stage.groups.map((g) => (
                  <div key={g.name}>
                    <h3 className="mb-2 font-mono text-xs tracking-wide text-faint uppercase">
                      {g.name} · {g.items.length}
                    </h3>
                    <Items items={g.items} status={stage.status} />
                  </div>
                ))}
              </div>
            )}
            {stage.items && (
              <div className="mt-3">
                <Items items={stage.items} status={stage.status} />
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-4 rounded-lg border border-line p-4 text-ink">
        Our rules: ranking can&apos;t be bought, and every burn comes from real paid calls.
      </p>
      <p className="mt-4 text-sm text-muted">
        Plans can change as we learn what agents and builders need. Follow along on{" "}
        <a href="https://x.com/useautonomo">X</a> and <a href="https://t.me/autonomodotfun">Telegram</a>.
      </p>
    </div>
  );
}
