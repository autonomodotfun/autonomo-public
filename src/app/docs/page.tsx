import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { getStats, listAutonomoGateways } from "@/lib/queries";
import { compact } from "@/components/project-row";
import { CopyButton } from "@/components/copy-button";
import { privyEnabled } from "@/lib/privy";
import { verifiedAmount, verifiedEnabled } from "@/lib/verified";
import { proConfig } from "@/lib/pro";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How Autonomo works: launch an x402 API that AI agents pay per call, use the official Autonomo APIs from the MCP server, the Telegram bot or your own code, and find your way around the catalog.",
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "how-x402-works", label: "How x402 works" },
  { id: "launch", label: "Launch your API" },
  { id: "official-apis", label: "Official APIs" },
  { id: "mcp", label: "MCP server" },
  { id: "agents", label: "Pay from your own code" },
  { id: "telegram", label: "Telegram bot & Playground" },
  { id: "api", label: "API reference" },
  { id: "pro", label: "Pro API" },
  { id: "data", label: "Where the data comes from" },
  { id: "token", label: `${TOKEN.symbol} token` },
  { id: "roadmap", label: "Roadmap & status" },
  { id: "faq", label: "FAQ" },
];

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";

// Seller example follows the x402 seller quickstart (docs.x402.org), on testnet.
const SELLER_INSTALL = "npm install @x402/express @x402/core @x402/evm";

const SELLER_CODE = `import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
const payTo = "0xYourWalletAddress"; // where payments land

// Testnet facilitator (Base Sepolia). Switch to a mainnet facilitator to go live.
const facilitator = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:84532", payTo }],
        description: "Current weather for a city",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitator).register("eip155:84532", new ExactEvmScheme()),
  ),
);

app.get("/weather", (req, res) => {
  res.json({ city: "Lisbon", weather: "sunny", tempC: 24 });
});

app.listen(4021);`;

const SELLER_TEST = `curl -i http://localhost:4021/weather
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: <price, network and payTo, base64-encoded>`;

const DISCOVER_CODE = `const res = await fetch(
  "${SITE}/api/v1/projects?q=weather&network=base&sort=price&limit=5",
);
const { data } = await res.json();

for (const p of data) {
  console.log(p.name, p.website, p.minPriceUsd);
}`;

const BUYER_INSTALL = "npm install @x402/fetch @x402/core @x402/evm viem";

const BUYER_CODE = `import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// A dedicated agent wallet with a small balance: USDG or $AUTONOMO on Robinhood Chain
// for Autonomo gateways, or USDC for most other x402 APIs (often on Base).
const signer = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`);

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Pays automatically when the API answers 402, then retries.
const res = await fetchWithPayment("${SITE}/x/token-price/price/autonomo");
console.log(await res.json());`;

const PRO_CODE = `import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`);
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Endpoints under $0.01 matching "weather", cheapest first
const res = await fetchWithPayment(
  "${SITE}/api/v1/pro/endpoints?q=weather&maxPrice=0.01&sort=price",
);
const { data } = await res.json(); // url, method, priceUsd, network, payTo, ...`;

const MCP_CLAUDE_CODE = "claude mcp add autonomo -e AUTONOMO_WALLET_KEY=0xYOUR_AGENT_WALLET_KEY -- npx -y autonomo-mcp";

const MCP_JSON = `{
  "mcpServers": {
    "autonomo": {
      "command": "npx",
      "args": ["-y", "autonomo-mcp"],
      "env": { "AUTONOMO_WALLET_KEY": "0xYOUR_AGENT_WALLET_KEY" }
    }
  }
}`;

const MCP_TOOLS: [string, string][] = [
  ["find_apis", "Search Autonomo's official APIs, and optionally the whole x402 directory. Free."],
  ["get_price", "Call an API without paying and show what it asks for. Free."],
  ["call_api", "Pay for one call and return the answer, with the payment link on Blockscout."],
];

// The APIs Autonomo runs itself (official-apis/tools). Each sits behind its own gateway at /x/<slug>.
const OFFICIAL_APIS: { name: string; slug: string; path: string; about: string }[] = [
  { name: "Token Price", slug: "token-price", path: "/price/autonomo", about: `The live ${TOKEN.symbol} price` },
  { name: "Token Lookup", slug: "token-lookup", path: "/price/<token>", about: "Price and market cap of any Robinhood Chain launchpad token, from its bonding curve or, after graduation, its Uniswap v4 pool" },
  { name: "New Launches", slug: "new-launches", path: "/launches?limit=10", about: "The newest launchpad tokens: age, buys, sells, market cap and curve progress" },
  { name: "Risk Checker", slug: "token-risk", path: "/risk/<token>", about: "A rug-risk score from holder concentration, the creator, launch-block buyers and bot volume" },
  { name: "Tx Explainer", slug: "tx-explainer", path: "/tx/<hash>", about: "A Robinhood Chain transaction in plain English: launches, buys, sells, transfers and fee" },
  { name: "Wallet Portfolio", slug: "wallet-portfolio", path: "/portfolio/<wallet>", about: "ETH, USDG, WETH, $AUTONOMO and recently received tokens, valued in USD, with impostor tokens flagged" },
  { name: "Page Reader", slug: "page-reader", path: "/page?url=<https link>", about: "Title, description and readable text of a public web page" },
];

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

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
      "the Telegram bot and four more official APIs are complete, and the Autonomo MCP server is in progress",
    items: [
      { title: "Autonomo agent bot for Telegram", note: "Live at t.me/autonomoagentbot: ask in a DM or a group, with free daily answers", done: true },
      { title: "More official APIs", note: "Token Lookup, Tx Explainer, Wallet Portfolio and Page Reader", done: true },
      { title: "Automatic directory refresh", note: "The x402 catalog is re-imported every 3 days", done: true },
      {
        title: "Autonomo MCP server",
        note: "First version on npm as autonomo-mcp: Claude, Cursor, Codex and other agents find and pay APIs natively",
        now: true,
      },
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
      { title: "Verified API listings and reputation" },
    ],
  },
];

const PHASE_STYLE: Record<Phase["status"], { label: string; className: string }> = {
  live: { label: "Live", className: "bg-brand text-on-brand" },
  building: { label: "Building now", className: "border border-accent text-accent" },
  next: { label: "Next", className: "border border-line text-muted" },
  later: { label: "Later", className: "border border-line text-faint" },
};

const ENDPOINTS: [string, string][] = [
  ["GET /api/v1/projects", "Search and filter projects: q, category, network, sort, page, limit"],
  ["GET /api/v1/projects/{slug}", "One project with up to 500 paid endpoints, prices, networks and 30-day calls"],
  ["GET /api/v1/stats", "Totals, counts per category and the most common networks"],
  ["GET /api/v1/gateways", "Every live Autonomo gateway, with the URL and path to call (used by the MCP server)"],
  ["GET /api/v1/pro/endpoints", "Paid: endpoint-level search with payment details (see Pro API)"],
];

const FAQ: [string, React.ReactNode][] = [
  [
    "Does Autonomo take a cut of payments?",
    <>No. Payments go straight from the agent&apos;s wallet to your <code>payTo</code> wallet. For hosted gateways, Autonomo&apos;s facilitator settles the payment on-chain and pays the gas, but never holds the money. Autonomo is only paid for its own <a href="#official-apis">official APIs</a> and the <a href="#pro">Pro API</a>.</>,
  ],
  [
    "Does Autonomo host my API?",
    <>No. Your API runs wherever it runs today. A <a href="#launch">hosted gateway</a> sits in front of it, takes the payment and forwards the request; or you run x402 yourself and Autonomo just lists it.</>,
  ],
  [
    "How much does it cost to launch?",
    <>Nothing. Launching a gateway and getting listed are free, whether your API comes from a facilitator catalog, the dashboard or the launch form.</>,
  ],
  [
    "Is the discovery API free?",
    <>Yes, with no key. The <a href="#pro">Pro API</a> adds paid, endpoint-level search, paid per call with x402.</>,
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
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 sm:px-6 lg:grid-cols-[13rem_1fr]">
      <aside className="text-sm lg:sticky lg:top-6 lg:self-start">
        <h2 className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">On this page</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:block lg:space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded py-1 text-muted hover:text-ink lg:px-2">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </aside>

      <article className="min-w-0 max-w-3xl">
        <p className="font-mono text-xs tracking-wide text-accent uppercase">Docs</p>
        <h1 className="heading mt-2 text-4xl sm:text-5xl">Launch an API agents pay for</h1>

        <Section id="overview" title="Overview">
          <p>
            Autonomo is the agentic x402 launchpad for APIs. You put a price on an endpoint, launch it here, and AI
            agents can find it and pay for each call. Agents need no API keys, accounts or invoices: just a wallet.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>Hosted gateways</b> put any existing API behind x402 in a few clicks, paid in USDG or {TOKEN.symbol} on{" "}
              {TOKEN.chainName}.
            </li>
            <li>
              <b>Official APIs</b> run by Autonomo cover token prices, new launches, rug risk, transactions, wallets and
              web pages.
            </li>
            <li>
              <b>Agents</b> use them through the <a href="#mcp">MCP server</a>, the{" "}
              <a href="#telegram">Telegram bot</a>, the <Link href="/playground">Agent Playground</Link> or{" "}
              <a href="#agents">their own code</a>.
            </li>
            <li>
              <b>The directory</b> tracks the wider x402 ecosystem: paid services, facilitators, SDKs and explorers.
            </li>
          </ul>
          <p>
            Autonomo currently lists {compact(stats.projects)} projects and {compact(stats.endpoints)} paid endpoints,
            which handled {compact(stats.calls30d)} paid calls in the last 30 days.
          </p>
          <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
            <Card title="I have an API" href="#launch" body="Charge agents per call and get discovered." />
            <Card title="I use Claude, Cursor or Codex" href="#mcp" body="Add the MCP server and let your agent pay." />
            <Card title="I'm building an agent" href="#agents" body="Find paid APIs and pay for them in code." />
          </div>
        </Section>

        <Section id="how-x402-works" title="How x402 works">
          <p>
            x402 uses the HTTP status code <code>402 Payment Required</code>. Payment happens inside a normal HTTP
            request:
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>The agent calls your endpoint.</li>
            <li>
              Your server answers <code>402</code> with a <code>PAYMENT-REQUIRED</code> header: the price, the network
              and your <code>payTo</code> wallet.
            </li>
            <li>
              The agent signs a stablecoin payment and retries with a <code>PAYMENT-SIGNATURE</code> header.
            </li>
            <li>
              A facilitator verifies and settles the payment on-chain, and your server returns the data. The money lands
              in your wallet.
            </li>
          </ol>
          <p>
            Prices can be fractions of a cent, so per-call pricing works for data, inference and tools that would never
            justify a subscription.
          </p>
        </Section>

        <Section id="launch" title="Launch your API">
          <div className="rounded-lg border border-line bg-surface p-5">
            <h3 className="font-medium">Launch without code: hosted gateway</h3>
            <p className="mt-2 text-muted">
              Already have an API? Sign in on the <Link href="/dashboard">dashboard</Link>
              {privyEnabled() ? " with email, Google, X or a wallet" : " with your wallet"}, paste your API&apos;s URL and set a
              price.{privyEnabled() ? " If you don't have a wallet, one is created for your earnings." : ""} Autonomo gives you a gateway at <code>autonomo.fun/x/your-api</code> that answers{" "}
              <code>402</code>, takes payment in USDG or {TOKEN.symbol} on {TOKEN.chainName}, and forwards paid requests to your
              API. Payments go straight to your wallet, and your dashboard shows calls and earnings.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Your API must be public and use https. Gateways don&apos;t follow redirects.</li>
              {verifiedEnabled() && (
                <li>Launching is free. Hold about {verifiedAmount()} of {TOKEN.symbol} in your wallet and your APIs show as Verified. The amount in tokens is set each week from the previous week&apos;s average price, rounded to the nearest 100,000. Once you qualify, your amount is locked: it won&apos;t go up, and it moves down if the weekly amount falls below it. The tokens stay yours. If your balance drops below your amount, you lose the badge and the lock, and qualify again at the current weekly amount. Verified shows the provider holds the token; it isn&apos;t a review of the API.</li>
              )}
              <li>If your API needs a key, add it as an auth header; it&apos;s encrypted and added to every forwarded call.</li>
              <li>Requests up to 1 MB and responses up to 5 MB, with a 25-second timeout.</li>
              <li>A payment only settles when your API answers successfully (status below 400).</li>
              <li>Autonomo settles payments on {TOKEN.chainName} itself and pays the gas. Paying in {TOKEN.symbol} needs a one-time Permit2 approval from the agent.</li>
              <li>Once it&apos;s live, request a listing from the dashboard so it shows up in the directory and in agent searches.</li>
            </ul>
          </div>
          <p>Or run x402 on your own server:</p>
          <Step n={1} title="Add x402 to your server">
            <p>Install the middleware for your framework. This example uses Express; Next.js, Hono, Fastify, Go and Python work the same way.</p>
            <Code code={SELLER_INSTALL} lang="bash" />
            <Code code={SELLER_CODE} lang="ts" />
            <p>
              This runs on Base Sepolia, a testnet, so you can try it without real money. To go live, switch to a
              mainnet network (Base is <code>eip155:8453</code>) and a mainnet facilitator, as described in the{" "}
              <a href="https://docs.x402.org/getting-started/quickstart-for-sellers">x402 seller quickstart</a>.
            </p>
          </Step>
          <Step n={2} title="Check that it answers 402">
            <Code code={SELLER_TEST} lang="bash" />
          </Step>
          <Step n={3} title="Launch it on Autonomo">
            <p>There are two ways to get a self-hosted endpoint listed:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <b>Automatically.</b> Register your endpoint with a facilitator that supports Bazaar discovery. Autonomo
                imports the Coinbase CDP and PayAI catalogs, groups endpoints by host and shows price, network and
                usage.
              </li>
              <li>
                <b>Through the launch form.</b> <Link href="/submit">Request a launch</Link> with your website and a paid
                endpoint URL. Every request is reviewed by hand, and APIs with a live <code>402</code> endpoint go
                fastest.
              </li>
            </ul>
          </Step>
        </Section>

        <Section id="official-apis" title="Official APIs">
          <p>
            Autonomo runs its own APIs for {TOKEN.chainName}, each behind a gateway and payable per call in USDG or{" "}
            {TOKEN.symbol}. Call them at <code>{SITE.replace(/^https?:\/\//, "")}/x/&lt;slug&gt;&lt;path&gt;</code>.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {OFFICIAL_APIS.map((a) => (
                  <tr key={a.slug}>
                    <td className="py-2.5 pr-4 pl-4 align-top">
                      <span className="font-medium whitespace-nowrap text-ink">{a.name}</span>
                      <span className="block font-mono text-xs whitespace-nowrap text-faint">
                        /x/{a.slug}
                        {a.path}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 align-top text-muted">{a.about}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Everything is read from public chains. Try any of them without a wallet in the{" "}
            <Link href="/playground">Agent Playground</Link>.
          </p>
        </Section>

        <Section id="mcp" title="MCP server">
          <p>
            <code>autonomo-mcp</code> gives Claude, Cursor, Codex and any other MCP client access to Autonomo&apos;s
            APIs. The agent finds an API, checks the price and pays per call in USDG or {TOKEN.symbol} on{" "}
            {TOKEN.chainName}. It runs on your own computer, so your wallet key stays there.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {MCP_TOOLS.map(([tool, desc]) => (
                  <tr key={tool}>
                    <td className="py-2.5 pr-4 pl-4 align-top font-mono text-xs whitespace-nowrap">{tool}</td>
                    <td className="py-2.5 pr-4 text-muted">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Step n={1} title="Fund a wallet for your agent">
            <p>
              Make a new wallet just for your agent and send it a little USDG or {TOKEN.symbol} on {TOKEN.chainName}.
              Paying in {TOKEN.symbol} also needs a little ETH once, for the Permit2 approval.
            </p>
          </Step>
          <Step n={2} title="Add the server to your client">
            <p>Claude Code:</p>
            <Code code={MCP_CLAUDE_CODE} lang="bash" />
            <p>
              Claude Desktop, Cursor and others (<code>claude_desktop_config.json</code>, <code>.cursor/mcp.json</code>,
              …):
            </p>
            <Code code={MCP_JSON} lang="json" />
            <p className="text-sm text-muted">
              Without a key, <code>find_apis</code> and <code>get_price</code> still work. Windows, Codex and all
              settings are covered on the{" "}
              <a href="https://www.npmjs.com/package/autonomo-mcp">autonomo-mcp package page</a>.
            </p>
          </Step>
          <Step n={3} title="Ask">
            <p>
              For example: <i>&ldquo;Is token 0x… safe? Use Autonomo.&rdquo;</i> Your client asks before each tool call,
              so you approve every payment unless you choose to allow it always.
            </p>
          </Step>
          <p className="text-sm text-muted">
            The server only pays Autonomo gateways, caps each call, and stops at a daily budget (set with{" "}
            <code>AUTONOMO_DAILY_USDG</code> and <code>AUTONOMO_DAILY_AUTONOMO</code>).
          </p>
        </Section>

        <Section id="agents" title="Pay from your own code">
          <Step n={1} title="Find APIs to pay for">
            <p>
              Search the catalog through the free discovery API. No key is needed and CORS is open, so it works from
              servers, browsers and agent tools. <code>GET /api/v1/gateways</code> lists Autonomo&apos;s own gateways
              with the path to call.
            </p>
            <Code code={DISCOVER_CODE} lang="ts" />
          </Step>
          <Step n={2} title="Pay per call">
            <p>
              Wrap <code>fetch</code> with an x402 client. When an API answers <code>402</code>, the client pays and
              retries automatically.
            </p>
            <Code code={BUYER_INSTALL} lang="bash" />
            <Code code={BUYER_CODE} lang="ts" />
            <p className="text-sm text-muted">
              Use a dedicated wallet for your agent and keep only a small balance in it. Never commit private keys.
            </p>
          </Step>
        </Section>

        <Section id="telegram" title="Telegram bot & Playground">
          <p>
            <b>The Autonomo agent bot</b> answers questions in Telegram using the official APIs and pays for them
            itself. Message <a href="https://t.me/autonomoagentbot">@autonomoagentbot</a> directly or mention it in a
            group. Each user gets a few free paid answers a day.
          </p>
          <p>
            <b>The <Link href="/playground">Agent Playground</Link></b> shows the same agent at work in the browser: ask a
            question and watch it find an API, read the live <code>402</code> price, pay in {TOKEN.symbol} and answer
            with an on-chain receipt. No wallet or signup needed.
          </p>
        </Section>

        <Section id="api" title="API reference">
          <p>
            Read-only JSON, free while in beta. No key, open CORS, and responses are cached for 5 minutes. Full
            parameters and examples are on the <Link href="/api-docs">API reference page</Link>.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {ENDPOINTS.map(([path, desc]) => (
                  <tr key={path}>
                    <td className="py-2.5 pr-4 pl-4 align-top font-mono text-xs whitespace-nowrap">{path}</td>
                    <td className="py-2.5 pr-4 text-muted">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="pro" title="Pro API">
          <p>
            <code>GET /api/v1/pro/endpoints</code> searches individual endpoints across the whole catalog and returns
            what an agent needs to call and pay them: URL, method, price, network, asset, <code>payTo</code>, scheme,
            facilitator and 30-day usage. Filter by <code>q</code>, <code>network</code> and <code>maxPrice</code>{" "}
            (USD), sort by <code>popular</code> or <code>price</code>, up to 200 results per page. Testnet endpoints
            are left out.
          </p>
          <p>It is paid per call with x402 in USDG or {TOKEN.symbol}, so there is no key or account: the agent pays and gets the data.</p>
          {!proConfig && (
            <p className="rounded-lg border border-dashed border-line px-4 py-3 text-muted">
              <b className="text-ink">Coming soon.</b> Until it is switched on, it answers <code>503</code>.
            </p>
          )}
          <Code code={PRO_CODE} lang="ts" />
          <h3 className="pt-2 font-medium">Paying with USDG</h3>
          <p className="text-sm text-muted">These notes apply to every Autonomo gateway too, not only the Pro API.</p>
          <p>
            USDG (Global Dollar) on {TOKEN.chainName} supports EIP-3009, so each payment is a single signature: no
            approval step and no gas for the agent. Hold USDG on {TOKEN.chainName} and the x402 client above handles the
            rest.
          </p>
          <h3 className="pt-2 font-medium">Paying with {TOKEN.symbol}</h3>
          <p>
            {TOKEN.symbol} payments run on {TOKEN.chainName} through Permit2. Before the first payment, the paying wallet
            approves the Permit2 contract (<code>{PERMIT2}</code>) to spend its {TOKEN.symbol}, once, which needs a little
            ETH on {TOKEN.chainName} for gas. After that, each call is a signature and the agent pays no gas.
          </p>
        </Section>

        <Section id="data" title="Where the data comes from">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Paid services</b> come from the Coinbase CDP and PayAI Bazaar discovery catalogs. Endpoints are grouped
              into one project per host, with price, network, facilitator and 30-day usage for each.
            </li>
            <li>
              <b>Autonomo gateways</b> appear once their owner requests a listing and it is approved.
            </li>
            <li>
              <b>Ecosystem projects</b> such as facilitators, SDKs, extensions and explorers are checked by hand.
            </li>
            <li>
              <b>Testnet-only</b> services are hidden. The catalog is re-imported every 3 days, so new endpoints can take
              a few days to appear.
            </li>
            <li>
              <b>Usage numbers</b> are paid calls reported by facilitators over the last 30 days.
            </li>
          </ul>
        </Section>

        <Section id="token" title={`${TOKEN.symbol} token`}>
          <p>The official {TOKEN.symbol} contract address is:</p>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap select-all">
              {TOKEN.address}
            </code>
            <CopyButton
              text={TOKEN.address}
              label={`Copy ${TOKEN.symbol} contract address`}
              className="btn-brand shrink-0 px-3 py-1.5 text-xs"
            />
          </div>
          <p>
            {TOKEN.symbol} runs on {TOKEN.chainName}. Agents can use it to pay for the{" "}
            <a href="#official-apis">official APIs</a>, any hosted gateway whose owner accepts it, and the{" "}
            <a href="#pro">Pro API</a>
            {proConfig?.rails.some((r) => r.kind === "autonomo") ? "" : " once it is switched on"}. The Agent Playground
            and the Telegram bot pay in {TOKEN.symbol}.
          </p>
          <p>
            The address is also in the bar at the top of every page. Always check it on autonomo.fun before you buy:
            copies posted elsewhere can be fake. Nothing on this site is financial advice.
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
          <dl className="divide-y divide-line border-y border-line">
            {FAQ.map(([q, a]) => (
              <div key={q} className="py-4">
                <dt className="font-medium">{q}</dt>
                <dd className="mt-1 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </article>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-6">
      <h2 className="heading text-2xl">{title}</h2>
      <div className="docs-body mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 pt-2">
      <h3 className="flex items-baseline gap-2 font-medium">
        <span className="font-mono text-xs text-accent">0{n}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Card({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <a href={href} className="bg-bg p-4 no-underline hover:bg-surface">
      <span className="font-medium text-ink">{title} →</span>
      <span className="mt-1 block text-sm text-muted">{body}</span>
    </a>
  );
}

function Code({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="relative rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-xs text-faint">{lang}</span>
        <CopyButton text={code} label="Copy code" className="font-mono text-xs text-muted uppercase hover:text-ink" />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
