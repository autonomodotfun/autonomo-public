import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Use Autonomo from LangChain",
  description: `LangChain tools for Python and TypeScript: an agent finds the right Autonomo API for its task, checks the price and pays for the call in USDG or ${TOKEN.symbol} on ${TOKEN.chainName}, within your limits.`,
};

// The examples on this page are the files in sdk/langchain/*/examples, which are checked against LangChain itself.
const example = (lang: "typescript" | "python") =>
  readFileSync(join(process.cwd(), "sdk", "langchain", lang, "examples", lang === "typescript" ? "agent.ts" : "agent.py"), "utf8")
    .replace(/\r\n/g, "\n")
    .trim();

const KEYS = `# macOS and Linux
export AUTONOMO_WALLET_KEY=0x…
export ANTHROPIC_API_KEY=…

# Windows PowerShell
$env:AUTONOMO_WALLET_KEY = "0x…"
$env:ANTHROPIC_API_KEY = "…"`;

const CLIENT_TS = `import { Autonomo } from "autonomo-sdk";

const client = new Autonomo({ privateKey: process.env.AUTONOMO_WALLET_KEY, borro: { account: "0xYourCreditLine" } });
const toolkit = new AutonomoToolkit({ client, maxCalls: 5 });`;

const CLIENT_PY = `from autonomo import Autonomo

client = Autonomo(private_key=os.environ["AUTONOMO_WALLET_KEY"], borro_account="0xYourCreditLine")
toolkit = AutonomoToolkit(client, max_calls=5)`;

const FREE_TS = `const tools = new AutonomoToolkit().getTools(); // autonomo_find_apis and autonomo_get_price only`;
const FREE_PY = `tools = AutonomoToolkit().get_tools()  # autonomo_find_apis and autonomo_get_price only`;

const TOOLS: [string, string][] = [
  ["autonomo_find_apis", "Free. The best APIs for a task, or all of them: what each does, its path, its price and its track record"],
  ["autonomo_get_price", "Free. What one call would cost, every way to pay it, and the exact URL"],
  ["autonomo_call_api", "Pays. Calls the API and returns its answer with a receipt: the route, the amount and the transaction link"],
];

export default function LangChainGuidePage() {
  return (
    <Page title="Use Autonomo from LangChain">
      <p>
        <code>langchain-autonomo</code> gives a LangChain or LangGraph agent Autonomo&apos;s APIs as tools, in Python and
        TypeScript. You give the agent a task, and it finds the right API, checks the price and pays for the call itself,
        in USDG or {TOKEN.symbol} on {TOKEN.chainName}. You don&apos;t write code for each API: an API listed on Autonomo
        tomorrow works the same way.
      </p>
      <Table
        rows={[
          ["Works with", <>LangChain and LangGraph, in Python (3.10 or later) and TypeScript (Node 20 or later)</>],
          ["The agent needs", <>A wallet just for it, with a little USDG. Most APIs cost 0.01 USDG</>],
          ["Built on", <>The <Link href="/docs/sdk">Autonomo SDK</Link>, so it pays and keeps to limits the same way</>],
        ]}
      />

      <Section title="Set up">
        <Step n={1} title="Install it">
          <Code code="pip install langchain-autonomo langchain" lang="bash" />
          <Code code="npm install langchain-autonomo langchain @langchain/core" lang="bash" />
        </Step>
        <Step n={2} title="Make a wallet for the agent">
          <p>
            Make a <b>new wallet just for the agent</b> and send it only what it may spend: a dollar of USDG on{" "}
            {TOKEN.chainName} covers about 100 calls. Paying in {TOKEN.symbol} also needs a little ETH once, for a
            Permit2 approval. Then set its key, and your model provider&apos;s key, in the terminal:
          </p>
          <Code code={KEYS} lang="bash" />
        </Step>
        <Step n={3} title="Give the agent the tools">
          <Code code={example("python")} lang="Python" />
          <Code code={example("typescript")} lang="TypeScript" />
          <p>
            Any chat model that can call tools works. Swap <code>anthropic:claude-sonnet-5-5</code> for the one you use.
          </p>
        </Step>
      </Section>

      <Section title="What the agent does">
        <Step n={1} title="It finds the API">
          <p>
            For &quot;is this token safe?&quot;, it asks <code>autonomo_find_apis</code> and gets the APIs that take a
            token address, best first, each with its price and track record. It picks Token Risk.
          </p>
        </Step>
        <Step n={2} title="It checks the price against your limits">
          <p>
            <code>autonomo_call_api</code> reads the price before signing anything. A call above the per-call cap, past
            today&apos;s budget or past <code>max_calls</code> is refused, and the agent is told why, so it can choose a
            cheaper API or answer with what it has.
          </p>
        </Step>
        <Step n={3} title="It pays and reads the answer">
          <p>
            It pays 0.01 USDG with a signed x402 payment and gets the report back with a receipt that links the payment on
            Blockscout. Autonomo settles it on-chain and pays the gas. If the API fails, the payment doesn&apos;t settle,
            so the agent isn&apos;t charged.
          </p>
        </Step>
      </Section>

      <Section title="The tools">
        <Table mono rows={TOOLS} />
        <p>Without a wallet key, the toolkit gives only the two free tools, so an agent can look but not pay:</p>
        <Code code={FREE_PY} lang="Python" />
        <Code code={FREE_TS} lang="TypeScript" />
      </Section>

      <Section title="Limits">
        <Table
          rows={[
            ["Per call", <>The most one call may cost. Default 0.05 USDG or 5,000 {TOKEN.symbol}</>],
            ["Per day", <>Per UTC day, shared with the SDK in <code>~/.autonomo/spend.json</code>. Default 1 USDG or 10,000 {TOKEN.symbol}</>],
            [<><code>max_calls</code> / <code>maxCalls</code></>, "Paid calls through one toolkit, then the tool stops. Default 10; None or null for no limit"],
            [<><code>max_output_chars</code> / <code>maxOutputChars</code></>, "Longer answers are cut before they reach the model. Default 20,000 characters"],
          ]}
        />
      </Section>

      <Section title="Gloam, Borro and other options">
        <p>
          The toolkit takes the same options as the <Link href="/docs/sdk">SDK</Link>, or a client you made yourself. To
          borrow from a <Link href="/docs/borro">Borro credit line</Link> when the wallet is short:
        </p>
        <Code code={CLIENT_PY} lang="Python" />
        <Code code={CLIENT_TS} lang="TypeScript" />
        <p>
          With <Link href="/docs/gloam">Gloam</Link> set up the same way, the agent can ask for a private payment. A
          private call only ever pays through Gloam, never as a public payment. See{" "}
          <Link href="/docs/sdk#pay-privately-with-gloam">Pay privately with Gloam</Link> in the SDK guide for the setup.
        </p>
      </Section>

      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Prefer APIs marked <Link href="/docs/token">Verified</Link> with a good track record. Autonomo lists outside
            creators&apos; APIs too, and doesn&apos;t vouch for each one. The find tool tells the model to prefer verified ones.
          </li>
          <li>Each paid call is public on {TOKEN.chainName}: the wallet, the amount and the API it paid.</li>
          <li>
            The packages are open source: <code>langchain-autonomo</code> on PyPI and npm. Their tests run offline against
            a fake Autonomo and pay nothing.
          </li>
          <li>
            Not on LangChain? Use the <Link href="/docs/sdk">SDK</Link> directly, or the{" "}
            <Link href="/docs/agents#mcp">MCP server</Link> in Claude, Cursor and other MCP clients.
          </li>
        </ul>
      </Section>
    </Page>
  );
}
