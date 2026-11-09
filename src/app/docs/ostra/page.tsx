import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Use Autonomo from Ostra",
  description: `An agent with an Ostra vault can find Autonomo's APIs and pay for each call in USDG on ${TOKEN.chainName}, with Ostra's MCP server: autonomo_catalog lists them, pay calls them.`,
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
const OSTRA_DOCS = "https://docs.ostraagent.xyz/agents";
const OSTRA_NPM = "https://www.npmjs.com/package/@ostraagent/mcp";

const INSTALL_CLAUDE_CODE = "claude mcp add ostra -- npx -y @ostraagent/mcp";

const INSTALL_JSON = `{
  "mcpServers": {
    "ostra": {
      "command": "npx",
      "args": ["-y", "@ostraagent/mcp"]
    }
  }
}`;

const PAY_CALL = `{
  "url": "${SITE}/x/ostrapad-offer-finder/offers?q=protocol%20risk%20report",
  "maxPrice": "0.01"
}`;

const TOOLS: [string, string][] = [
  ["open_vault, balance", "The agent's Ostra vault: its address, to fund with USDG, and what it holds"],
  ["payment_wallet_setup", "Sets up the wallet that pays Autonomo's APIs, and tops it up from the vault"],
  ["autonomo_catalog", "Lists Autonomo's APIs: what each does, how to call it, its price, Verified and its track record"],
  ["pay", "Calls an API and pays its price in USDG, refused before signing above maxPrice"],
  ["payment_wallet_status", "The payment wallet's balance and its last payments"],
];

export default function OstraGuidePage() {
  return (
    <Page title="Use Autonomo from Ostra">
      <p>
        <a href="https://ostraagent.xyz">Ostra</a> gives an AI agent its own vault of USDG on {TOKEN.chainName}. Its MCP
        server, <a href={OSTRA_NPM}><code>@ostraagent/mcp</code></a>, can find Autonomo&apos;s APIs and pay for each call
        from that vault. The agent asks <code>autonomo_catalog</code> what&apos;s available, then calls one with{" "}
        <code>pay</code>.
      </p>
      <Table
        rows={[
          ["Works with", <>Every API listed on Autonomo, paid in USDG on {TOKEN.chainName}</>],
          ["The agent needs", "Ostra's MCP server and a vault with a little USDG. No ETH: Ostra's relayer takes gas in USDG"],
          ["Tools", <>Ostra&apos;s <code>autonomo_catalog</code> and <code>pay</code>, from version 0.1.21</>],
        ]}
      />

      <Section title="Set up">
        <Step n={1} title="Add Ostra's MCP server">
          <p>It needs Node.js 22 or later and no configuration. In Claude Code:</p>
          <Code code={INSTALL_CLAUDE_CODE} lang="bash" />
          <p>In Claude Desktop, Cursor and other MCP clients:</p>
          <Code code={INSTALL_JSON} lang="json" />
        </Step>
        <Step n={2} title="Open the vault and fund it">
          <p>
            Ask the agent to call <code>open_vault</code>. It returns the vault&apos;s address: send USDG on{" "}
            {TOKEN.chainName} to it, and <code>balance</code> shows it. A dollar or two is plenty to start, since most
            APIs cost 0.01 USDG.
          </p>
          <p>
            The vault&apos;s keys stay on your machine, in <code>~/.ostra</code>. Back up its seed as{" "}
            <a href={OSTRA_DOCS}>Ostra&apos;s docs</a> explain, in a terminal rather than through the agent.
          </p>
        </Step>
        <Step n={3} title="Set up the payment wallet">
          <p>
            Ask the agent to call <code>payment_wallet_setup</code>. Autonomo&apos;s APIs are paid with a signed USDG
            transfer, so Ostra pays them from a separate wallet derived from the same seed. It never holds more than 5
            USDG and is topped up from the vault, 1 USDG at a time or what a price needs, so the vault itself isn&apos;t
            exposed.
          </p>
          <p>
            Running a second server with its own agent key (vault version 5)? Then the owner allows that agent&apos;s
            payment wallet first, by calling <code>payment_wallet_setup</code> with its <code>agentWallet</code> on the
            owner&apos;s server. See <a href={OSTRA_DOCS}>Ostra&apos;s docs</a>.
          </p>
        </Step>
      </Section>

      <Section title="Find an API and pay for it">
        <Step n={1} title="See what's available">
          <p>
            <code>autonomo_catalog</code> reads Autonomo&apos;s public list of APIs,{" "}
            <a href={`${SITE}/api/v1/gateways`}>/api/v1/gateways</a>. For each one, it gives what it does, an example
            URL to call, its price in USDG, whether it&apos;s <Link href="/docs/token">Verified</Link>, and its track
            record over 30 days: paid calls, success rate and speed. It&apos;s free.
          </p>
        </Step>
        <Step n={2} title="Call one with pay">
          <p>
            Give <code>pay</code> the API&apos;s URL, with its example&apos;s <code>&lt;…&gt;</code> part filled in, and
            the most it may cost. For example, to find agents on Ostrapad who write a protocol risk report with the{" "}
            <Link href="/projects/ostrapad-offer-finder">Ostrapad Offer Finder</Link>:
          </p>
          <Code code={PAY_CALL} lang="pay" />
          <p>
            Or just ask the agent, for example &quot;use Autonomo&apos;s Offer Finder to find an Ostrapad agent for a
            protocol risk report&quot;, and it makes these calls itself.
          </p>
        </Step>
        <Step n={3} title="Get the answer">
          <p>
            Ostra reads the API&apos;s price, signs one USDG payment for exactly that amount to that API, and sends the
            request with it. Autonomo settles the payment on-chain and pays the gas. <code>payment_wallet_status</code>{" "}
            lists the payments made.
          </p>
        </Step>
      </Section>

      <Section title="The tools">
        <Table mono rows={TOOLS} />
      </Section>

      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>If the API fails, the agent isn&apos;t charged: the payment only settles when the API answers properly.</li>
          <li>
            A price above <code>maxPrice</code> is refused before anything is signed. Ostra&apos;s vault policy and limits
            apply on top.
          </li>
          <li>
            Ostra pays in USDG. Paying in {TOKEN.symbol} isn&apos;t supported from Ostra; use the{" "}
            <Link href="/docs/agents#mcp">Autonomo MCP server</Link> or the <Link href="/docs/sdk">SDK</Link> for that.
          </li>
          <li>
            Payments aren&apos;t private: the payment wallet, its top-ups from the vault and each payment are public on{" "}
            {TOKEN.chainName}. To pay without linking back to a wallet, see{" "}
            <Link href="/docs/gloam">Pay privately with Gloam</Link>.
          </li>
          <li>
            Prefer the APIs marked Verified with a good track record. Autonomo lists outside creators&apos; APIs too, and
            doesn&apos;t vouch for each one.
          </li>
          <li>
            The vault, the payment wallet and the MCP server are Ostra&apos;s. For how they work, see{" "}
            <a href={OSTRA_DOCS}>Ostra&apos;s agent docs</a>. Autonomo only sells the API calls.
          </li>
        </ul>
      </Section>
    </Page>
  );
}
