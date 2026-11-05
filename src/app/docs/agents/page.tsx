import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Card, Cards, Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Use Autonomo from your agent",
  description: `Let Claude, Cursor, Codex or your own code find APIs on Autonomo and pay per call in USDG or ${TOKEN.symbol}, or try the Agent Playground and the Telegram bot.`,
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

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

export default function AgentsGuidePage() {
  return (
    <Page title="Use Autonomo from your agent">
      <p>
        Agents pay for each API call themselves, in USDG or {TOKEN.symbol} on {TOKEN.chainName}. There are no API keys or
        accounts, just a wallet. Pick the way that fits you:
      </p>
      <Cards>
        <Card title="MCP server" href="#mcp" body="Claude, Cursor, Codex and other AI apps find and pay APIs for you." />
        <Card title="Your own code" href="#code" body="Search the catalog and pay with an x402 client in a few lines." />
        <Card title="Try it first" href="#telegram" body="The Playground and Telegram bot pay for you. No wallet needed." />
      </Cards>

      <Section id="mcp" title="MCP server">
        <p>
          <code>autonomo-mcp</code> gives Claude, Cursor, Codex and any other MCP client access to Autonomo&apos;s APIs.
          The agent finds an API, checks the price and pays per call. It runs on your own computer, so your wallet key
          stays there.
        </p>
        <Table mono rows={MCP_TOOLS} />
        <Step n={1} title="Fund a wallet for your agent">
          <p>
            Make a new wallet just for your agent and send it a little USDG or {TOKEN.symbol} on {TOKEN.chainName}. Paying
            in {TOKEN.symbol} also needs a little ETH once, for the Permit2 approval.
          </p>
        </Step>
        <Step n={2} title="Add the server to your app">
          <p>Claude Code:</p>
          <Code code={MCP_CLAUDE_CODE} lang="bash" />
          <p>
            Claude Desktop, Cursor and others (<code>claude_desktop_config.json</code>, <code>.cursor/mcp.json</code>, …):
          </p>
          <Code code={MCP_JSON} lang="json" />
          <p className="text-sm text-muted">
            Without a key, <code>find_apis</code> and <code>get_price</code> still work. Windows, Codex and all settings
            are covered on the <a href="https://www.npmjs.com/package/autonomo-mcp">autonomo-mcp package page</a>.
          </p>
        </Step>
        <Step n={3} title="Ask">
          <p>
            For example: <i>&ldquo;Is token 0x… safe? Use Autonomo.&rdquo;</i> Your app asks before each tool call, so you
            approve every payment unless you choose to allow it always.
          </p>
        </Step>
        <p className="text-sm text-muted">
          The server only pays Autonomo gateways, caps each call, and stops at a daily budget (set with{" "}
          <code>AUTONOMO_DAILY_USDG</code> and <code>AUTONOMO_DAILY_AUTONOMO</code>). Use a new wallet with a small
          balance, never your main one.
        </p>
      </Section>

      <Section id="code" title="Pay from your own code">
        <Step n={1} title="Find APIs to pay for">
          <p>
            Search the catalog through the free discovery API. No key is needed and CORS is open, so it works from
            servers, browsers and agent tools. <code>GET /api/v1/gateways</code> lists Autonomo&apos;s own gateways with
            the path to call. Every endpoint is on the <Link href="/api-docs">API reference</Link>.
          </p>
          <Code code={DISCOVER_CODE} lang="ts" />
        </Step>
        <Step n={2} title="Pay per call">
          <p>
            Wrap <code>fetch</code> with an x402 client. When an API answers <code>402</code>, the client pays and retries
            automatically.
          </p>
          <Code code={BUYER_INSTALL} lang="bash" />
          <Code code={BUYER_CODE} lang="ts" />
          <p className="text-sm text-muted">
            Use a dedicated wallet for your agent and keep only a small balance in it. Never commit private keys.
          </p>
        </Step>
        <h3 className="pt-2 font-medium">Paying with USDG</h3>
        <p>
          USDG (Global Dollar) on {TOKEN.chainName} supports EIP-3009, so each payment is a single signature: no approval
          step and no gas for the agent. Hold USDG on {TOKEN.chainName} and the x402 client above handles the rest.
        </p>
        <h3 className="pt-2 font-medium">Paying with {TOKEN.symbol}</h3>
        <p>
          {TOKEN.symbol} payments run on {TOKEN.chainName} through Permit2. Before the first payment, the paying wallet
          approves the Permit2 contract (<code>{PERMIT2}</code>) to spend its {TOKEN.symbol}, once, which needs a little ETH
          on {TOKEN.chainName} for gas. After that, each call is a signature and the agent pays no gas.
        </p>
      </Section>

      <Section id="telegram" title="Agent Playground and Telegram bot">
        <p>
          <b>The <Link href="/playground">Agent Playground</Link></b> is the quickest way to see it work: ask a question in
          your browser and watch an AI agent pick the APIs it needs, read the live <code>402</code> price, pay in{" "}
          {TOKEN.symbol} and answer with an on-chain receipt for every call. No wallet or signup needed, with a few free
          questions a day.
        </p>
        <p>
          <b>The Autonomo agent bot</b> does the same in Telegram. Message{" "}
          <a href="https://t.me/autonomoagentbot">@autonomoagentbot</a> directly or mention it in a group. Each user gets a
          few free paid answers a day.
        </p>
        <p>
          Both use the <Link href="/docs/official-apis">official APIs</Link>.
        </p>
      </Section>
    </Page>
  );
}
