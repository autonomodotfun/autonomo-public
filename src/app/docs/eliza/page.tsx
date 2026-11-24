import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Use Autonomo from elizaOS",
  description: `An elizaOS plugin: your agent finds the right Autonomo API for what it's asked, checks the price and pays for the call in USDG or ${TOKEN.symbol} on ${TOKEN.chainName} or USDC on Base, within the limits in its settings.`,
};

const INSTALL = "npm install elizaos-plugin-autonomo";

const AGENT = `import { autonomoPlugin } from "elizaos-plugin-autonomo";

export const projectAgent = {
  character,
  plugins: [autonomoPlugin],
};`;

const SECRETS = `{
  "name": "Scout",
  "settings": {
    "secrets": {
      "AUTONOMO_WALLET_KEY": "0x…",
      "AUTONOMO_DAILY_USDG": "0.50"
    }
  }
}`;

const ENV = `AUTONOMO_WALLET_KEY=0x…
AUTONOMO_DAILY_USDG=0.50`;

const IN_CODE = `import { createAutonomoPlugin } from "elizaos-plugin-autonomo";

const autonomo = createAutonomoPlugin({
  limits: { perCall: { usdg: "0.02" }, daily: { usdg: "0.50" } },
  borro: { account: "0xYourCreditLine" },
});`;

const ACTIONS: [string, string][] = [
  ["AUTONOMO_FIND_APIS", "Free. The best APIs for a task, or all of them: what each does, its path, its price and its track record"],
  ["AUTONOMO_GET_PRICE", "Free. What one call would cost, every way to pay it, and the exact URL"],
  ["AUTONOMO_CALL_API", "Pays. Calls the API and returns its answer with a receipt: the amount and the transaction link"],
];

export default function ElizaGuidePage() {
  return (
    <Page title="Use Autonomo from elizaOS">
      <p>
        <code>elizaos-plugin-autonomo</code> gives an <a href="https://elizaos.ai">elizaOS</a> agent Autonomo&apos;s
        APIs as actions. Someone asks the agent &quot;is this token safe?&quot;, and it finds the right API, checks the
        price and pays for the call itself, in USDG or {TOKEN.symbol} on {TOKEN.chainName}, or in USDC on Base. You
        don&apos;t write code for each API: an API listed on Autonomo tomorrow works the same way.
      </p>
      <Table
        rows={[
          ["Works with", <>elizaOS 1.x (1.7 or later) and 2.x, from one package</>],
          ["The agent needs", <>A wallet just for it, with a little USDG, or USDC on Base. Most APIs cost 0.01 of either</>],
          ["Built on", <>The <Link href="/docs/sdk">Autonomo SDK</Link>, so it pays and keeps to limits the same way</>],
        ]}
      />

      <Section title="Set up">
        <Step n={1} title="Install it">
          <Code code={INSTALL} lang="bash" />
        </Step>
        <Step n={2} title="Add it to your agent">
          <Code code={AGENT} lang="TypeScript" />
        </Step>
        <Step n={3} title="Give the agent a wallet">
          <p>
            Make a <b>new wallet just for the agent</b> and send it only what it may spend: a dollar of USDG on{" "}
            {TOKEN.chainName} covers about 100 calls, and so does a dollar of USDC on Base, from the same wallet. Paying
            in {TOKEN.symbol} also needs a little ETH once, for a Permit2 approval. Put its key in the character&apos;s
            secrets:
          </p>
          <Code code={SECRETS} lang="JSON" />
          <p>
            Or in your project&apos;s <code>.env</code>:
          </p>
          <Code code={ENV} lang="bash" />
          <p>Without a key, the agent can find APIs and check prices, but isn&apos;t offered the paying action.</p>
        </Step>
      </Section>

      <Section title="What the agent does">
        <Step n={1} title="It finds the API">
          <p>
            For &quot;is this token safe?&quot; with a token address, it looks through Autonomo&apos;s APIs for one that
            takes a token address, best first, each with its price and track record. It picks Token Risk.
          </p>
        </Step>
        <Step n={2} title="It checks the price against your limits">
          <p>
            The price is read before anything is signed. A call above the per-call cap or past today&apos;s budget is
            refused, and the agent is told why, so it can choose a cheaper API or answer with what it has.
          </p>
        </Step>
        <Step n={3} title="It pays and answers">
          <p>
            It pays 0.01 USDG with a signed x402 payment, answers from the report and adds what it paid, with a link to
            the payment on Blockscout, or on Basescan when it paid in USDC on Base. The payment is settled on-chain for
            the agent, which pays no gas. If the API fails, the payment
            doesn&apos;t settle, so the agent isn&apos;t charged.
          </p>
        </Step>
      </Section>

      <Section title="The actions">
        <Table mono rows={ACTIONS} />
        <p>
          On elizaOS 2.x, the planner fills in each action&apos;s parameters and writes the reply. On 1.x, the action
          reads what&apos;s needed from the message with the agent&apos;s small model. Either way, the address,
          transaction hash or link it pays to look up is one written in the message, and the line saying what was paid
          comes from the payment receipt, not from the model.
        </p>
      </Section>

      <Section title="Settings">
        <p>All optional. Set them in the character&apos;s secrets or settings, or in the environment.</p>
        <Table
          mono
          rows={[
            ["AUTONOMO_WALLET_KEY", "The agent wallet's private key. Without it, the free actions only"],
            ["AUTONOMO_PAY_WITH", `usdg, autonomo, usdc (on Base), or auto: USDG first, then ${TOKEN.symbol}, then USDC on Base. Default auto`],
            ["AUTONOMO_MAX_USDG_PER_CALL", "The most one call may cost in USDG or USDC. Default 0.05"],
            ["AUTONOMO_MAX_AUTONOMO_PER_CALL", `The most one call may cost in ${TOKEN.symbol}. Default 5000`],
            ["AUTONOMO_DAILY_USDG", "The most to spend per UTC day in USDG and USDC together. Default 1"],
            ["AUTONOMO_DAILY_AUTONOMO", `The most to spend per UTC day in ${TOKEN.symbol}. Default 10000`],
            ["AUTONOMO_BORRO_ACCOUNT", "A Borro credit line to borrow from when the wallet is short of USDG"],
            ["AUTONOMO_MAX_OUTPUT_CHARS", "Longer answers are cut before they reach the model or the chat. Default 8000"],
          ]}
        />
        <p>
          A setting the plugin can&apos;t read as written, like a limit that isn&apos;t a number, turns paying off until
          it&apos;s fixed. The agent logs which setting, and the free actions keep working. A typo never becomes a looser
          limit.
        </p>
      </Section>

      <Section title="Set it in code">
        <p>
          To set limits in code instead, or to borrow from a <Link href="/docs/borro">Borro credit line</Link>, make the
          plugin yourself. It takes the same options as the <Link href="/docs/sdk">SDK</Link>, and they win over the
          agent&apos;s settings:
        </p>
        <Code code={IN_CODE} lang="TypeScript" />
        <p>
          With <Link href="/docs/gloam">Gloam</Link> set up the same way (see{" "}
          <Link href="/docs/sdk#pay-privately-with-gloam">Pay privately with Gloam</Link>), the paying action gets a{" "}
          <code>private</code> option. A private call only ever pays through Gloam, never as a public payment.
        </p>
      </Section>

      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Anyone who can talk to the agent can ask it to make a paid call.</b> On Discord, Telegram or X, that is every
            user. The daily budget is the most they can spend between them, so set it to what you&apos;re fine losing in
            a day.
          </li>
          <li>
            Today&apos;s spending is kept in <code>~/.autonomo/spend.json</code>, shared with the SDK and CLI on the same
            machine. On a host that wipes its disk on each deploy, the daily count starts again after a deploy.
          </li>
          <li>
            Prefer APIs marked <Link href="/docs/token">Verified</Link> with a good track record. Autonomo lists outside
            creators&apos; APIs too, and doesn&apos;t vouch for each one.
          </li>
          <li>Each paid call is public on {TOKEN.chainName} or Base: the wallet, the amount and the API it paid.</li>
          <li>
            The plugin is open source and its tests run offline against a fake Autonomo, paying nothing. Not on elizaOS?
            Use <Link href="/docs/langchain">LangChain</Link>, the <Link href="/docs/sdk">SDK</Link>, or the{" "}
            <Link href="/docs/agents#mcp">MCP server</Link>.
          </li>
        </ul>
      </Section>
    </Page>
  );
}
