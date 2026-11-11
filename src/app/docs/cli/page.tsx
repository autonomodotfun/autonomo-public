import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Card, Cards, Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Use Autonomo from your terminal",
  description: `The Autonomo CLI: one command finds an x402 API, pays for the call in USDG or ${TOKEN.symbol} on ${TOKEN.chainName}, privately through Gloam or on Borro credit, within your limits, and prints the answer.`,
};

const TOKEN_EXAMPLE = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49";

const LOOK = `npx autonomo-sdk find "wallet holdings"
npx autonomo-sdk risk ${TOKEN_EXAMPLE} --dry-run`;

const LOOK_OUTPUT = `Risk Checker (token-risk)
  https://autonomo.fun/x/token-risk/risk/${TOKEN_EXAMPLE}
  0.01 USDG
  100 AUTONOMO
  0.010667 USDG  private, through Gloam`;

const KEY = `# macOS and Linux
export AUTONOMO_WALLET_KEY=0x…

# Windows PowerShell
$env:AUTONOMO_WALLET_KEY = "0x…"`;

const PAY = `npx autonomo-sdk risk ${TOKEN_EXAMPLE}`;

const PAY_OUTPUT = `Risk Checker costs 0.01 USDG or 100 AUTONOMO. Pay from 0x…? [y/N] y
{ "token": "0x86b5…", "risk": { "level": "low", … }, … }
Paid 0.01 USDG to Risk Checker. Today: 0.01 of 1 USDG.
https://robinhoodchain.blockscout.com/tx/0x…`;

const CALL = `npx autonomo-sdk call "explain this transaction" 0x…
npx autonomo-sdk call --slug token-risk --path /risk/${TOKEN_EXAMPLE}`;

const LIMITS = `npx autonomo-sdk risk ${TOKEN_EXAMPLE} --max 0.02 --daily 0.5
npx autonomo-sdk spend`;

const GLOAM_ENV = `GLOAM_NETWORK=robinhood-mainnet
GLOAM_AGENT_PRIVATE_KEY=0x…
GLOAM_LIMIT_NETWORK=robinhood-mainnet
GLOAM_LIMIT_ASSETS=USDG
GLOAM_LIMIT_MAX_PER_PAYMENT=0.05
GLOAM_LIMIT_MAX_PER_DAY=1
GLOAM_LIMIT_RECIPIENTS=any`;

const PRIVATE = `npx autonomo-sdk risk ${TOKEN_EXAMPLE} --private --dry-run
npx autonomo-sdk risk ${TOKEN_EXAMPLE} --private`;

const RETRY = `npx autonomo-sdk risk ${TOKEN_EXAMPLE} --private --retry-header <header>`;

const BORRO = `npx autonomo-sdk risk ${TOKEN_EXAMPLE} --borro 0x…`;

const SCRIPT = `# The answer is on stdout, so it pipes. The receipt goes to stderr.
npx autonomo-sdk price --yes | jq .

# One object with both, for an agent to read.
npx autonomo-sdk launches 5 --json`;

export default function CliGuidePage() {
  return (
    <Page title="Use Autonomo from your terminal">
      <p>
        The Autonomo CLI is one command that finds an API on Autonomo, pays for the call on {TOKEN.chainName} and prints the
        answer. There&apos;s nothing to install and no code to write, and looking around is free. It&apos;s part of the{" "}
        <Link href="/docs/sdk">SDK</Link>&apos;s npm package, so the same spending limits apply.
      </p>
      <Cards cols={2}>
        <Card title="Try it free" href="#try" body="Search the APIs and see prices. No wallet needed." />
        <Card title="Pay for a call" href="#pay" body="Set one wallet key and run a command." />
        <Card title="Pay privately" href="#private" body="From a private Gloam balance, with Gloam's own key." />
        <Card title="Scripts and agents" href="#scripts" body="JSON output, exit codes and no questions asked." />
      </Cards>

      <Section id="try" title="Try it free">
        <p>
          You need Node.js 20 or newer. These two commands cost nothing and need no wallet: the first searches the APIs, the
          second shows what a Risk Checker call would cost.
        </p>
        <Code code={LOOK} lang="bash" />
        <Code code={LOOK_OUTPUT} lang="output" />
        <p className="text-sm text-muted">
          Put a search of more than one word in quotes. <code>--dry-run</code> works on every command that pays.
        </p>
      </Section>

      <Section id="pay" title="Pay for a call">
        <Step n={1} title="Make a wallet for the agent">
          <p>
            Create a new wallet just for this, and send it a little USDG or {TOKEN.symbol} on {TOKEN.chainName}. Keep only
            what it may spend in it. Paying in {TOKEN.symbol} also needs a little ETH once, for a one-time approval.
          </p>
        </Step>
        <Step n={2} title="Set its key">
          <p>
            The key is read only from <code>AUTONOMO_WALLET_KEY</code>. It&apos;s never taken as a flag, so it stays out of
            your shell history.
          </p>
          <Code code={KEY} lang="bash" />
        </Step>
        <Step n={3} title="Run a command">
          <Code code={PAY} lang="bash" />
          <p>At a terminal it shows the price and asks before paying. Then it prints the answer and a receipt:</p>
          <Code code={PAY_OUTPUT} lang="output" />
        </Step>
      </Section>

      <Section id="commands" title="Commands">
        <Table
          mono
          rows={[
            ["find [words] [input]", "List APIs, best matches first. Free"],
            ["quote <words> [input]", "The API a call would use, and its prices. Free"],
            ["call <words> [input]", "Find the right API, pay for one call, print the answer"],
            ["spend", "Today's spending against your limits. Free"],
            ["price [token]", `${TOKEN.symbol}'s price, or any launchpad token's`],
            ["launches [how many]", "Newest token launches"],
            ["risk <token>", "Rug-risk check"],
            ["tx <hash>", "A transaction in plain words"],
            ["portfolio <wallet>", "What a wallet holds"],
            ["read <https link>", "A web page's text"],
            ["offers <what you need>", "Matching offers on Ostrapad"],
          ]}
        />
        <p>
          The last seven are shortcuts for the <Link href="/docs/official-apis">official APIs</Link>. For any other API,
          say what you need with <code>call</code>, or name the API yourself with <code>--slug</code> and{" "}
          <code>--path</code>:
        </p>
        <Code code={CALL} lang="bash" />
        <p className="text-sm text-muted">
          <code>call</code> picks the API from your words, so check its choice with <code>quote</code> or{" "}
          <code>--dry-run</code> first. At a terminal the question before paying names the API too.
        </p>
      </Section>

      <Section id="options" title="Options">
        <Table
          mono
          rows={[
            ["--dry-run", "Show the price instead of paying"],
            ["--yes", "Don't ask before paying"],
            ["--json", "One object on stdout: the answer and the receipt"],
            ["--max <usdg>", "Most to pay for one call. Default 0.05"],
            ["--daily <usdg>", "Most to spend per UTC day. Default 1"],
            ["--max-autonomo, --daily-autonomo", `The same two limits in ${TOKEN.symbol}. Defaults 5,000 and 10,000`],
            ["--pay-with <token>", "usdg, autonomo or auto. Default: USDG, then " + TOKEN.symbol],
            ["--private", "Pay from your private Gloam balance"],
            ["--retry-header <header>", "With --private: finish a call that was paid but not answered"],
            ["--borro <credit line>", "Borrow from this Borro line when the wallet is short of USDG"],
            ["--slug <api> --path <path>", "With call or quote: use this API and path, skipping the search"],
            ["--help, --version", "Every option and exit code, and the version"],
          ]}
        />
      </Section>

      <Section id="limits" title="Limits">
        <p>
          Two limits are checked before anything is signed: the most for one call, and the most per UTC day. A call over
          either is refused, not paid. Today&apos;s spending is kept in <code>~/.autonomo/spend.json</code>, shared with
          the SDK on the same machine.
        </p>
        <Code code={LIMITS} lang="bash" />
      </Section>

      <Section id="private" title="Pay privately with Gloam">
        <p>
          Every official API also takes a payment from a private <Link href="/docs/gloam">Gloam</Link> balance, so the
          payment doesn&apos;t link back to your wallet. Add <code>--private</code> and the command starts Gloam&apos;s own
          server, <code>@gloamtrade/mcp</code>, on your machine for that one payment and stops it afterwards.
        </p>
        <Step n={1} title="Give Gloam its own key and limits">
          <p>
            Put these in <code>~/.gloam/agent.env</code> and keep the file private. <code>GLOAM_AGENT_PRIVATE_KEY</code> is
            the key Gloam spends with. The Autonomo command never reads it, and Gloam&apos;s server is never given{" "}
            <code>AUTONOMO_WALLET_KEY</code>.
          </p>
          <Code code={GLOAM_ENV} lang="~/.gloam/agent.env" />
        </Step>
        <Step n={2} title="Deposit USDG into its private balance">
          <p>
            Gloam pays from a private balance, not from a wallet. The SDK guide shows how to move USDG in and check it:
            see <Link href="/docs/sdk#pay-privately-with-gloam">Pay privately with Gloam</Link>.
          </p>
        </Step>
        <Step n={3} title="Pay">
          <p>
            No <code>AUTONOMO_WALLET_KEY</code> is needed. The first line shows the private price, the second pays it:
          </p>
          <Code code={PRIVATE} lang="bash" />
        </Step>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>The price includes Gloam&apos;s fee</b> and counts against <code>--max</code> and <code>--daily</code> as
            USDG.
          </li>
          <li>
            <b>It can take a few minutes,</b> because Gloam builds the payment&apos;s proofs on your machine.
          </li>
          <li>
            <b>It can&apos;t be combined</b> with <code>--pay-with</code> or <code>--borro</code>.
          </li>
          <li>
            <b>Paid but no answer?</b> The error prints a payment header. Don&apos;t run the command again as it was: add
            the header, and you get the answer without paying twice.
          </li>
        </ul>
        <Code code={RETRY} lang="bash" />
      </Section>

      <Section id="borro" title="Pay on Borro credit">
        <p>
          With a <Link href="/docs/borro">Borro credit line</Link>, the command borrows just what the wallet is short of
          and pays in the same call. Pass the credit line&apos;s address, or set it once in{" "}
          <code>AUTONOMO_BORRO_ACCOUNT</code>. <code>AUTONOMO_WALLET_KEY</code> is the agent wallet set on that line.
        </p>
        <Code code={BORRO} lang="bash" />
        <p className="text-sm text-muted">Borrowed payments count against the USDG limits like any other.</p>
      </Section>

      <Section id="scripts" title="For scripts and agents">
        <p>
          Claude Code, Codex, Cursor and any other agent that runs shell commands can use the CLI with no setup beyond the
          wallet key. Outside a terminal it never asks a question, so nothing hangs.
        </p>
        <Code code={SCRIPT} lang="bash" />
        <p>Each way a call can end has its own exit code:</p>
        <Table
          mono
          rows={[
            ["0", "Done"],
            ["1", "Failed for another reason"],
            ["2", "Bad usage"],
            ["3", "Over a limit, so not paid"],
            ["4", "Can't pay: no wallet, an empty one, or Gloam isn't set up"],
            ["5", "The payment was refused, or was paid without an answer"],
            ["6", "No such API"],
          ]}
        />
        <p>
          With <code>--json</code>, an error is one object on stderr: <code>{'{ "error": { "code", "message" } }'}</code>.
        </p>
      </Section>

      <Section id="good-to-know" title="Good to know">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>The package is <code>autonomo-sdk</code>.</b> <code>npx autonomo</code> is someone else&apos;s package.
            After <code>npm install -g autonomo-sdk</code> the command is just <code>autonomo</code>.
          </li>
          <li>
            <b>It only pays Autonomo&apos;s gateways,</b> on {TOKEN.chainName}, in USDG or {TOKEN.symbol}.
          </li>
          <li>
            <b>A wallet payment only settles after the API answers,</b> so a call it fails to answer isn&apos;t
            charged. A private payment is made first; that&apos;s what <code>--retry-header</code> is for.
          </li>
          <li>
            <b>Writing code instead?</b> The same calls are one function in the{" "}
            <Link href="/docs/sdk">SDK for TypeScript and Python</Link>. For AI apps, see the{" "}
            <Link href="/docs/agents#mcp">MCP server</Link>.
          </li>
        </ul>
      </Section>
    </Page>
  );
}
