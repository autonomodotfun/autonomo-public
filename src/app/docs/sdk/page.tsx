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
const exampleFile = (lang: "typescript" | "python", file: string) =>
  readFileSync(join(process.cwd(), "sdk", lang, "examples", file), "utf8").replace(/\r\n/g, "\n").trim();
const example = (lang: "typescript" | "python", name: string) => exampleFile(lang, `${name}.${lang === "typescript" ? "ts" : "py"}`);

const TRY_SETUP = `mkdir try-autonomo && cd try-autonomo
npm init -y
npm install autonomo-sdk @modelcontextprotocol/sdk`;
const TRY_KEYS = `# macOS and Linux
export AUTONOMO_WALLET_KEY=0x…

# Windows PowerShell
$env:AUTONOMO_WALLET_KEY = "0x…"`;
const CLI_LOOK = `npx autonomo-sdk find "wallet holdings"
npx autonomo-sdk risk 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49 --dry-run`;

const CLI_PAY = `npx autonomo-sdk risk 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49
npx autonomo-sdk call "explain this transaction" 0x… --max 0.02 --daily 0.5 --json`;

const CLI_PRIVATE = `npx autonomo-sdk risk 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49 --private --dry-run
npx autonomo-sdk risk 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49 --private`;

const TRY_BORRO = `# macOS and Linux
export AUTONOMO_WALLET_KEY=0x…   # the agent wallet set on the credit line
export BORRO_CREDIT_LINE=0x…     # the credit line
node try-every-route.mjs borro

# Windows PowerShell
$env:AUTONOMO_WALLET_KEY = "0x…"
$env:BORRO_CREDIT_LINE = "0x…"
node try-every-route.mjs borro`;

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
        <Code code="pip install autonomo-sdk" lang="bash" />
        <p>
          TypeScript needs Node 20 or later, Python 3.10 or later. The Python SDK is also on PyPI as <code>autonomo</code>;
          either way, you import it from <code>autonomo</code>. Make a <b>new wallet just for your agent</b> and keep only
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

      <Section id="pay-privately-with-gloam" title="Pay privately with Gloam">
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
          <li>The price includes Gloam&apos;s cash-out fee, so 0.01 USDG becomes about 0.0105.</li>
          <li>What stays public: the amount, the API&apos;s payment address and the time. What stays private: which wallet paid.</li>
          <li>
            Gloam builds the payment&apos;s proofs on your machine, which can take a minute or two. MCP clients give up after
            60 seconds by default, so the examples wait up to 5 minutes.
          </li>
          <li>On Windows, <code>npx</code> is a script, so the TypeScript example starts the server through <code>cmd /c</code>.</li>
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

      <Section title="Try every route yourself">
        <p>
          One script tries each way to pay with one small call to{" "}
          <Link href="/projects/new-launches">New Launches</Link>: 0.01 USDG, or 100 {TOKEN.symbol}. Each command prints
          the receipt with its transaction link, so you can check what happened on-chain. It&apos;s capped at 0.02 USDG a
          call and 0.10 USDG a day. It runs on Node, which Gloam&apos;s server needs anyway; the Python examples above do
          the same things.
        </p>
        <Step n={1} title="Set up a folder">
          <Code code={TRY_SETUP} lang="bash" />
          <p>
            Save the script below in it as <code>try-every-route.mjs</code>, then check it works. <code>quote</code> is
            free and needs no wallet: it shows the API the calls will use and every price it takes.
          </p>
          <Code code="node try-every-route.mjs quote" lang="bash" />
        </Step>
        <Step n={2} title="Pay from a wallet: usdg and autonomo">
          <p>
            Use a <b>new wallet</b> with a few cents in it: 0.01 USDG for <code>usdg</code>, and 100 {TOKEN.symbol} plus
            a little ETH (once, for the Permit2 approval) for <code>autonomo</code>. Set its key in the terminal only,
            never in a file you share or commit.
          </p>
          <Code code={TRY_KEYS} lang="bash" />
          <Code code={"node try-every-route.mjs usdg\nnode try-every-route.mjs autonomo"} lang="bash" />
          <p>
            On Blockscout, the token moves from your wallet to the API&apos;s payment address. Autonomo&apos;s facilitator
            sends the transaction and pays the gas, so your wallet spends no ETH on it. Anyone can see this wallet paid.
          </p>
        </Step>
        <Step n={3} title="Pay privately: gloam">
          <p>Before you start:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Set up <code>~/.gloam/agent.env</code> as in <a href="#pay-privately-with-gloam">Pay privately with Gloam</a>.
              Its key is the wallet Gloam deposits from. It holds the USDG to deposit and a little ETH for the deposit&apos;s
              gas. This step needs no <code>AUTONOMO_WALLET_KEY</code>.
            </li>
            <li>
              Gloam&apos;s own limits must allow the payment: <code>USDG</code> as the asset, at least 0.011 per payment,
              and recipients <code>any</code>. The settings in that section do.
            </li>
            <li>
              <b>The deposit is public.</b> Anyone can see that the key&apos;s wallet put USDG into Gloam&apos;s vault.
              What stays private is which payments it made from there. Use a wallet of its own for Gloam if that matters.
            </li>
          </ul>
          <Code code={"node try-every-route.mjs gloam-shield 0.05\nnode try-every-route.mjs gloam-balance\nnode try-every-route.mjs gloam"} lang="bash" />
          <p>
            Deposit, check the balance shows as unspent, then pay. The payment takes a minute or two while Gloam builds
            its proofs on your machine. On Blockscout, Gloam&apos;s vault pays the API, sent by Gloam&apos;s relayer:
            your wallet isn&apos;t in the transaction.
          </p>
          <p>
            If it says <code>paid_not_served</code>, Gloam has paid but the API hadn&apos;t answered yet.{" "}
            <b>Don&apos;t run <code>gloam</code> again</b>, which would pay a second time. Pass the payment header it
            printed instead:
          </p>
          <Code code="node try-every-route.mjs gloam-retry <paymentHeader>" lang="bash" />
        </Step>
        <Step n={4} title="Borrow and pay: borro">
          <p>Before you start:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              A credit line, opened from an <b>owner wallet</b> as in{" "}
              <Link href="/docs/borro#open-a-credit-line">Open a credit line</Link>: buy a little CREDIT on Uniswap with
              USDG, post it as collateral on Borro with nothing borrowed, set the <b>agent wallet</b>, and tick{" "}
              <b>Let the agent pay its x402 bills</b>. It needs room to borrow 0.01 USDG today, under the line&apos;s
              ceiling and daily limit.
            </li>
            <li>
              <code>AUTONOMO_WALLET_KEY</code> is the <b>agent wallet set on the line</b>, not the line&apos;s owner, and{" "}
              <code>BORRO_CREDIT_LINE</code> is the line&apos;s address.
            </li>
            <li>
              The agent wallet must be <b>short of USDG</b>. With 0.01 USDG or more it just pays, and the receipt says{" "}
              <code>usdg</code>, not <code>borro</code>. A second wallet, with no USDG left over from step 2, is simplest.
            </li>
            <li>It needs a little ETH for the borrow transaction&apos;s gas: about 0.00003 ETH.</li>
          </ul>
          <Code code={TRY_BORRO} lang="bash" />
          <p>
            It prints two transactions. The borrow: the credit line lends what the wallet is short (all 0.01 when it holds
            none) to the agent wallet. Then the payment from that wallet to the API, a few seconds later. The line now owes
            what was borrowed, plus a little interest, until you repay it on Borro.
          </p>
        </Step>
        <Code code={exampleFile("typescript", "try-every-route.mjs")} lang="try-every-route.mjs" />
      </Section>

      <Section id="from-the-terminal" title="From the terminal">
        <p>
          The npm package also installs a command, for you and for agents that run shell commands. This is the short
          version; <Link href="/docs/cli">Use Autonomo from your terminal</Link> is the full guide. Looking is free and
          needs no wallet:
        </p>
        <Code code={CLI_LOOK} lang="bash" />
        <p>
          To pay, put the agent wallet&apos;s key in <code>AUTONOMO_WALLET_KEY</code>. It&apos;s never taken as a flag,
          so it stays out of your shell history.
        </p>
        <Code code={CLI_PAY} lang="bash" />
        <Table
          mono
          rows={[
            ["find [words] [input]", "List APIs, best matches first"],
            ["quote <words> [input]", "The API a call would use, and its prices"],
            ["call <words> [input]", "Find the right API, pay for one call, print the answer"],
            ["price, launches, risk, tx, portfolio, read, offers", "Shortcuts for the official APIs"],
            ["spend", "Today's spending against your limits"],
            ["--max, --daily", "The USDG limits for this call. --max-autonomo and --daily-autonomo for $AUTONOMO"],
            ["--private", "Pay from your private Gloam balance, with no wallet key"],
            ["--dry-run", "Show the price instead of paying"],
            ["--json", "One object on stdout: the answer and the receipt"],
          ]}
        />
        <p>
          At a terminal it shows the price and asks before paying; <code>--yes</code> skips the question, and scripts are
          never asked. The answer goes to stdout and the receipt to stderr, so piping works. Run{" "}
          <code>npx autonomo-sdk --help</code> for every option and the exit codes.
        </p>
        <h3 className="pt-2 font-medium">Paying privately from the terminal</h3>
        <p>
          Add <code>--private</code> and the command pays from your private Gloam balance instead of a wallet, so the
          payment doesn&apos;t link back to you. It starts Gloam&apos;s own server, <code>@gloamtrade/mcp</code>, on your
          machine for that one payment and stops it afterwards.
        </p>
        <Code code={CLI_PRIVATE} lang="bash" />
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>Your own Gloam key.</b> Set Gloam up once as in{" "}
            <a href="#pay-privately-with-gloam">Pay privately with Gloam</a>: its key and limits go in{" "}
            <code>~/.gloam/agent.env</code>, and USDG goes into its private balance. The command never reads that key,
            and Gloam&apos;s server is never given <code>AUTONOMO_WALLET_KEY</code>.
          </li>
          <li>
            <b>No wallet key needed.</b> <code>AUTONOMO_WALLET_KEY</code> can stay unset for private calls.
          </li>
          <li>
            <b>The price includes Gloam&apos;s fee</b> and counts against <code>--max</code> and <code>--daily</code>.{" "}
            <code>--dry-run</code> shows it first.
          </li>
          <li>
            <b>It can take a few minutes,</b> because Gloam builds the payment&apos;s proofs on your machine.
          </li>
          <li>
            <b>Paid but no answer?</b> The error prints a payment header. Run the same command again with{" "}
            <code>--retry-header &lt;header&gt;</code> to get the answer without paying twice.
          </li>
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
