import type { Metadata } from "next";
import Link from "next/link";
import { cursorDeeplink } from "@/data/mcp-install";
import { TOKEN } from "@/lib/constants";
import { Card, Cards, Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Use Autonomo from your agent",
  description: `Let Claude, Cursor, Codex or your own code find APIs on Autonomo and pay per call in USDG, ${TOKEN.symbol} or USDC on Base, or try the Agent Playground and the Telegram bot.`,
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const MCP_CLAUDE_CODE = "claude mcp add autonomo -e AUTONOMO_WALLET_KEY=0xYOUR_AGENT_WALLET_KEY -- npx -y autonomo-mcp";

const MCP_CODEX = "codex mcp add autonomo --env AUTONOMO_WALLET_KEY=0xYOUR_AGENT_WALLET_KEY -- npx -y autonomo-mcp";

const MCP_JSON = `{
  "mcpServers": {
    "autonomo": {
      "command": "npx",
      "args": ["-y", "autonomo-mcp"],
      "env": { "AUTONOMO_WALLET_KEY": "0xYOUR_AGENT_WALLET_KEY" }
    }
  }
}`;

const SKILL_PROMPT = `Install the skill at ${SITE}/skill.md`;

const SKILL_ADD = "npx skills add autonomodotfun/autonomo-public";

const MCP_TOOLS: [string, string][] = [
  ["find_apis", "Search Autonomo's official APIs, and optionally the whole x402 directory. Free."],
  ["get_price", "Call an API without paying and show what it asks for. Free."],
  ["wallet_status", "What the wallet holds on both chains, what it has spent today and its limits. Free."],
  ["call_api", "Pay for one call and return the answer, with the payment link on Blockscout or Basescan."],
];

const DISCOVER_CODE = `const res = await fetch(
  "${SITE}/api/v1/projects?q=weather&network=base&sort=price&limit=5",
);
const { data } = await res.json();

for (const p of data) {
  console.log(p.name, p.website, p.minPriceUsd);
}`;

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const BUYER_INSTALL = "npm install @x402/fetch @x402/core @x402/evm viem";

const BUYER_CODE = `import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// A dedicated agent wallet with a small balance: USDG or $AUTONOMO on Robinhood Chain
// (or USDC on Base) for Autonomo gateways, or USDC for most other x402 APIs (often on Base).
const signer = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`);

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));

// The client pays only tokens on its own list, and USDG on Robinhood Chain is not on it.
// This allows USDG, up to $0.50 a call (500000 in its smallest unit).
client.setSpendControls({
  allowedAssets: [{ network: "eip155:4663", asset: "${USDG}", maxAmountPerPayment: "500000" }],
});

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Token Lookup: the price of any token by its address, here ${TOKEN.symbol}.
// Pays automatically when the API answers 402, then retries.
const res = await fetchWithPayment("${SITE}/x/token-lookup/price/${TOKEN.address}");
console.log(await res.json());`;

export default function AgentsGuidePage() {
  return (
    <Page title="Use Autonomo from your agent">
      <p>
        Agents pay for each API call themselves, in USDG or {TOKEN.symbol} on {TOKEN.chainName}, or in USDC on Base.
        There are no API keys or accounts, just a wallet. Pick the way that fits you:
      </p>
      <Cards cols={2}>
        <Card title="MCP server" href="#mcp" body="Claude, Cursor, Codex and other AI apps find and pay APIs for you." />
        <Card title="Agent skill" href="#skill" body="One file that teaches your agent to find APIs, check prices and pay." />
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
            Make a new wallet just for your agent and send it a little USDG or {TOKEN.symbol} on {TOKEN.chainName}, or
            USDC on Base. The same wallet works on both chains. Paying in {TOKEN.symbol} also needs a little ETH once,
            for the Permit2 approval. USDG and USDC need none.
          </p>
        </Step>
        <Step n={2} title="Add the server to your app">
          <p>Claude Code:</p>
          <Code code={MCP_CLAUDE_CODE} lang="bash" />
          <p>Codex:</p>
          <Code code={MCP_CODEX} lang="bash" />
          <p id="cursor" className="scroll-mt-6">
            Cursor, in one click:
          </p>
          <p>
            <a href={cursorDeeplink()} className="btn-brand inline-block px-4 py-2 text-sm no-underline">
              Add to Cursor
            </a>
          </p>
          <p className="text-sm text-muted">
            Cursor opens and asks before it installs anything. The link carries no wallet key, so{" "}
            <code>find_apis</code> and <code>get_price</code> work right away. To pay for calls, add the key to the
            server&apos;s entry in <code>~/.cursor/mcp.json</code>, as in the block below. Keep the key in that file in
            your home folder, not in a project&apos;s <code>.cursor/mcp.json</code>, so it can&apos;t end up in git.
          </p>
          <p>
            Cursor by hand, Claude Desktop and others (<code>~/.cursor/mcp.json</code>,{" "}
            <code>claude_desktop_config.json</code>, …):
          </p>
          <Code code={MCP_JSON} lang="json" />
          <p className="text-sm text-muted">
            Without a key, <code>find_apis</code> and <code>get_price</code> still work. Windows and all the settings
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
          The server pays with the first the wallet can afford: USDG, then {TOKEN.symbol}, then USDC on Base. Set{" "}
          <code>AUTONOMO_PAY_WITH</code> to <code>usdg</code>, <code>autonomo</code> or <code>usdc</code> to use only
          one. It only pays Autonomo gateways, caps each call, and stops at a daily budget (set with{" "}
          <code>AUTONOMO_DAILY_USDG</code>, which covers USDG and USDC together, and{" "}
          <code>AUTONOMO_DAILY_AUTONOMO</code>). Use a new wallet with a small balance, never your main one.
        </p>
      </Section>

      <Section id="skill" title="Agent skill">
        <p>
          A skill is one text file that teaches an agent a job. Autonomo&apos;s teaches it to find an API, check the
          price and pay for one call with the <Link href="/docs/cli">CLI</Link>, inside your spending limits. It
          works in Claude Code, Cursor, Codex and other agents that read the{" "}
          <a href="https://agentskills.io">Agent Skills</a> format, and it installs nothing new: the agent runs{" "}
          <code>npx autonomo-sdk</code>.
        </p>
        <Step n={1} title="Install the skill">
          <p>Tell your agent:</p>
          <Code code={SKILL_PROMPT} lang="text" />
          <p>Or add it with the skills command:</p>
          <Code code={SKILL_ADD} lang="bash" />
          <p className="text-sm text-muted">
            By hand, save <a href="/skill.md">the file</a> as <code>.claude/skills/autonomo/SKILL.md</code> for Claude
            Code, or in the skills folder your agent reads.
          </p>
        </Step>
        <Step n={2} title="Give the agent a wallet">
          <p>
            The same as for the MCP server: a new wallet just for your agent, with a little USDG or {TOKEN.symbol} on{" "}
            {TOKEN.chainName}, or USDC on Base. Set its key as <code>AUTONOMO_WALLET_KEY</code> in your own shell, never
            in the chat. Finding APIs and checking prices work without it.
          </p>
        </Step>
        <Step n={3} title="Ask">
          <p>
            For example: <i>&ldquo;Is token 0x… safe? Use Autonomo.&rdquo;</i> The skill tells the agent to show you
            the price first and to wait for your yes before the first payment.
          </p>
        </Step>
        <p className="text-sm text-muted">
          A skill is instructions, not a lock. What holds in every case are the CLI&apos;s own limits (0.5 dollars a
          call and 5 dollars a day unless you change them) and what the wallet holds, so keep that wallet small.
        </p>
      </Section>

      <Section id="code" title="Pay from your own code">
        <p>
          The quickest way is the <Link href="/docs/sdk">SDK for TypeScript and Python</Link>: one call finds the API,
          pays within your limits, privately with Gloam or on Borro credit if you want, and returns a receipt. Building
          with LangChain or LangGraph? <Link href="/docs/langchain">Its tools</Link> let the agent pick and pay for APIs
          itself, and so does the <Link href="/docs/eliza">elizaOS plugin</Link>. To build it yourself, here are the two steps. No code at all? The same call is one command in{" "}
          <Link href="/docs/cli">your terminal</Link>. No x402 library for your language?{" "}
          <Link href="/docs/http">Pay over plain HTTP</Link> shows every header and field. To ask for a service and
          let Autonomo pick the API, see <Link href="/docs/router">the Router</Link>.
        </p>
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
          step and no gas for the agent. The x402 client pays only tokens on its own list unless you allow more, so
          the code above allows USDG with <code>setSpendControls</code>, with a limit for each call. Without those
          lines the client refuses a USDG price.
        </p>
        <h3 className="pt-2 font-medium">Paying with USDC on Base</h3>
        <p>
          Most Autonomo APIs also list USDC on Base in their <code>402</code>, at the same dollar price. It works like
          USDG: one EIP-3009 signature, no approval and no gas, settled by Coinbase&apos;s x402 facilitator. An x402
          client pays the first option it is allowed to, and USDG is listed first. For a wallet that only holds USDC on
          Base, leave out the <code>setSpendControls</code> lines: USDC on Base is on the client&apos;s own list, so it
          pays that option, up to $1 a call unless you set a lower limit. The{" "}
          <Link href="/docs/sdk#pay-on-base">SDK</Link> picks the chain for you.
        </p>
        <h3 className="pt-2 font-medium">Paying with {TOKEN.symbol}</h3>
        <p>
          {TOKEN.symbol} payments run on {TOKEN.chainName} through Permit2. Before the first payment, the paying wallet
          approves the Permit2 contract (<code>{PERMIT2}</code>) to spend its {TOKEN.symbol}, once, which needs a little ETH
          on {TOKEN.chainName} for gas. After that, each call is a signature and the agent pays no gas. With the x402
          client, allow the token the same way as USDG, and give the client a function that picks it:{" "}
          {TOKEN.symbol} is listed after USDG.
        </p>
        <h3 className="pt-2 font-medium">Paying privately with Gloam</h3>
        <p>
          Every API that accepts USDG also accepts a cash-out from a private Gloam balance, so the payment doesn&apos;t
          link back to your wallet. See <Link href="/docs/gloam">Pay privately with Gloam</Link>.
        </p>
        <h3 className="pt-2 font-medium">Paying with a Borro credit line</h3>
        <p>
          An agent with a Borro credit line can pay without holding USDG first: it borrows just what it&apos;s short and
          pays in the same request. See <Link href="/docs/borro">Pay with a Borro credit line</Link>.
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
          Its <Link href="/playground?mode=research">Research a token</Link> tab is the research agent: paste a token and it pays Token
          Risk, Dev Wallet Tracker, Holders &amp; Bundles, Tx Explainer and Wallet Portfolio one after another, then writes one
          report on the token, what its creator did, who really holds it, its launch and its largest holder.
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
