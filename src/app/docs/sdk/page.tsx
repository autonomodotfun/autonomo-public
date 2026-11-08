import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Pay for APIs in one call with the SDK",
  description: `The Autonomo SDK for TypeScript and Python: one call finds the right API, pays in USDG or ${TOKEN.symbol} on ${TOKEN.chainName}, privately through Gloam or on Borro credit, within your limits, and returns a receipt.`,
};

// The examples on this page are the files in sdk/*/examples, which are type-checked and run against the live site.
const example = (lang: "typescript" | "python", name: string) => {
  const file = join(process.cwd(), "sdk", lang, "examples", `${name}.${lang === "typescript" ? "ts" : "py"}`);
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
};

const GLOAM_ENV = `GLOAM_NETWORK=robinhood-mainnet
GLOAM_AGENT_PRIVATE_KEY=0x…
GLOAM_LIMIT_NETWORK=robinhood-mainnet
GLOAM_LIMIT_ASSETS=USDG
GLOAM_LIMIT_MAX_PER_PAYMENT=0.05
GLOAM_LIMIT_MAX_PER_DAY=1
GLOAM_LIMIT_RECIPIENTS=any`;

export default function SdkGuidePage() {
  return (
    <Page title="Pay for APIs in one call with the SDK">
      <p>
        The Autonomo SDK gives your agent one function, <code>call</code>. Say what you need, and it finds the right API on
        Autonomo, pays for it on {TOKEN.chainName} and returns the answer with a receipt. It works the same in TypeScript
        and Python.
      </p>
      <Table
        rows={[
          ["Finds the API", "From your words and the kind of input: a token or wallet address, a transaction hash or a link"],
          ["Pays", <>In USDG, or {TOKEN.symbol} when the wallet has no USDG</>],
          ["Privately", "Through Gloam, so the payment doesn't link to your wallet"],
          ["On credit", "Borrows from a Borro credit line when the wallet is short of USDG"],
          ["Within limits", "A most-per-call and a daily budget, checked before anything is signed"],
          ["Receipt", "Which API, how it was paid, the amount and the transaction link"],
        ]}
      />

      <Section title="Install">
        <Code code="npm install autonomo-sdk" lang="bash" />
        <Code code="pip install autonomo" lang="bash" />
        <p>
          TypeScript needs Node 20 or later, Python 3.10 or later. Make a <b>new wallet just for your agent</b> and keep only
          what it may spend in it. Most APIs cost 0.01 USDG, so 1 USDG is about 100 calls. Paying in {TOKEN.symbol} needs a
          little ETH once, for a Permit2 approval.
        </p>
      </Section>

      <Section title="Pay from the agent's wallet">
        <p>
          The usual way. The SDK pays in USDG if the wallet has enough, and otherwise in {TOKEN.symbol}. Set{" "}
          <code>payWith</code> (<code>pay_with</code> in Python) to <code>&quot;usdg&quot;</code> or{" "}
          <code>&quot;autonomo&quot;</code> to use only one.
        </p>
        <Code code={example("typescript", "pay")} lang="TypeScript" />
        <Code code={example("python", "pay")} lang="Python" />
        <Step n={1} title="It finds the API">
          <p>
            &quot;is this token safe&quot; plus a token address picks <Link href="/projects/token-risk">Token Risk</Link>{" "}
            and fills in its path. When two APIs fit, it picks the one that&apos;s Verified, with the better track record.
          </p>
        </Step>
        <Step n={2} title="It checks the price against your limits">
          <p>It asks the API for its price without paying. A price over your limits is refused here, before anything is signed.</p>
        </Step>
        <Step n={3} title="It pays and returns the answer">
          <p>
            It signs one x402 payment for exactly that price, to that API only, and sends the request with it. Autonomo
            settles it on-chain and pays the gas. If the API fails, the payment doesn&apos;t settle and you aren&apos;t
            charged.
          </p>
        </Step>
      </Section>

      <Section title="Pay privately with Gloam">
        <p>
          With <code>private: true</code> (<code>private=True</code>), the call is paid from a{" "}
          <Link href="/docs/gloam">private Gloam balance</Link>, so it doesn&apos;t link back to your wallet. The SDK hands
          the payment to Gloam&apos;s own MCP server, <code>@gloamtrade/mcp</code>, running on your machine: Gloam cashes
          out exactly the price through its relay and calls the API with it. The SDK never sees your Gloam key, and your
          agent&apos;s own wallet key isn&apos;t needed.
        </p>
        <Step n={1} title="Set up Gloam's server">
          <p>
            Put its settings in <code>~/.gloam/agent.env</code>, and keep the file private.{" "}
            <code>GLOAM_AGENT_PRIVATE_KEY</code> is the key Gloam spends with; it stays on this machine. Gloam won&apos;t
            spend without limits. Each Autonomo API is paid at its own address, so recipients is <code>any</code>, kept
            safe by small caps. Gloam&apos;s limits apply on top of the SDK&apos;s.
          </p>
          <Code code={GLOAM_ENV} lang="~/.gloam/agent.env" />
        </Step>
        <Step n={2} title="Fund its private balance">
          <p>
            Deposit USDG into that agent&apos;s private balance with Gloam&apos;s <code>gloam_execute_shield</code> tool. A
            balance in the Gloam app belongs to the app, not to the agent&apos;s server. See{" "}
            <a href="https://gloam.trade/docs/agents">Gloam&apos;s agent docs</a>.
          </p>
        </Step>
        <Step n={3} title="Call with private on">
          <Code code={example("typescript", "gloam")} lang="TypeScript" />
          <Code code={example("python", "gloam")} lang="Python" />
        </Step>
        <ul className="list-disc space-y-1 pl-5">
          <li>A private call is only ever paid through Gloam. If the API doesn&apos;t offer it, the call is refused, never paid publicly.</li>
          <li>The price includes Gloam&apos;s 0.5% cash-out fee, so 0.01 USDG becomes about 0.0101.</li>
          <li>What stays public: the amount, the API&apos;s payment address and the time. What stays private: which wallet paid.</li>
          <li>On Windows, start the server with <code>command: &quot;cmd&quot;</code> and <code>args: [&quot;/c&quot;, &quot;npx&quot;, &quot;-y&quot;, &quot;@gloamtrade/mcp&quot;]</code>.</li>
        </ul>
      </Section>

      <Section title="Borrow with a Borro credit line">
        <p>
          Set a <Link href="/docs/borro">Borro credit line</Link>, and when the wallet can&apos;t afford a call, the SDK
          borrows just what it&apos;s short and pays in the same call. It asks Borro&apos;s MCP server for the borrow, sends
          it from the wallet, waits for the USDG to arrive, then pays as usual.
        </p>
        <Code code={example("typescript", "borro")} lang="TypeScript" />
        <Code code={example("python", "borro")} lang="Python" />
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Open the line at <a href="https://borro.markets/app">borro.markets/app</a> with <b>Let the agent pay its x402 bills</b>{" "}
            ticked, for this agent&apos;s wallet. Borro&apos;s daily limit applies on top of the SDK&apos;s.
          </li>
          <li>The wallet needs a little ETH for the borrow transaction&apos;s gas.</li>
          <li>The receipt&apos;s route is <code>borro</code> when it borrowed, with the borrow transaction, or <code>usdg</code> when the wallet already had enough.</li>
          <li>Repaying the line is between you and Borro.</li>
        </ul>
      </Section>

      <Section title="Limits">
        <p>Every route checks both before anything is signed or sent. Set your own when you create the client:</p>
        <Table
          mono
          rows={[
            ["perCall / per_call", "Most for one call. Default 0.05 USDG and 5,000 AUTONOMO"],
            ["daily", "Most per UTC day. Default 1 USDG and 10,000 AUTONOMO. Gloam and Borro payments count as USDG"],
          ]}
        />
        <p>
          Today&apos;s spending is kept in <code>~/.autonomo/spend.json</code>, shared by the TypeScript and Python SDKs.
          For a server with many agents, pass your own <code>spendStore</code> (<code>spend_store</code>).
        </p>
      </Section>

      <Section title="The receipt">
        <Table
          mono
          rows={[
            ["api", "The API's slug and name"],
            ["route", "usdg, autonomo, gloam or borro"],
            ["amount, token", "What was paid"],
            ["payer, payTo", 'The wallet, or "private (Gloam)", and the API\'s payment address'],
            ["tx, explorer", "The payment transaction and its Blockscout link"],
            ["borrowTxs, approveTx", "Borro borrows and the one-time Permit2 approval, when there were any"],
            ["spentToday", "Today's total against the daily budget"],
          ]}
        />
        <p>Python uses snake_case for the same fields: <code>pay_to</code>, <code>borrow_txs</code>, <code>approve_tx</code>, <code>spent_today</code>.</p>
      </Section>

      <Section title="Look before paying">
        <p>
          <code>find</code> lists the APIs that match a request, and <code>quote</code> shows the API a call would use and
          every price, including the private one. Both are free and need no wallet. To skip the search, name the API with{" "}
          <code>slug</code> and <code>path</code>.
        </p>
      </Section>

      <Section title="When a call isn't paid">
        <p>
          Errors are an <code>AutonomoError</code> with a <code>code</code> and a plain reason, for example &quot;the wallet
          holds 0 USDG, the call costs 0.01&quot;.
        </p>
        <Table
          mono
          rows={[
            ["cannot_pay", "Over a limit, or the wallet can't afford any price the API takes. Nothing was signed"],
            ["over_limit", "A private call over a limit. Nothing was paid"],
            ["no_private_option", "The API doesn't offer Gloam. Nothing was paid"],
            ["no_wallet / no_gloam", "A key or the Gloam setup is missing"],
            ["borro_refused", "Borro refused the borrow, with its reason. Nothing was paid"],
            ["payment_refused", "The payment was refused, with the reason. You weren't charged"],
            ["paid_not_served", "Gloam paid but the API hadn't answered yet. Retry with the payment header it gives; don't pay again"],
          ]}
        />
      </Section>

      <p>
        Prefer no code? The <Link href="/docs/agents">MCP server</Link> gives Claude, Cursor and Codex the same APIs as
        tools.
      </p>
    </Page>
  );
}
