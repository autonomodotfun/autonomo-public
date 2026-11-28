import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { group } from "../nav";
import { Card, Cards, Code, Page, Section } from "../ui";

export const metadata: Metadata = {
  title: "Quickstart",
  description: `Your first paid call on Autonomo in three steps: try it free from your terminal, give your agent a wallet with a little USDG on ${TOKEN.chainName} or USDC on Base, and pay for a call.`,
};

const TOKEN_EXAMPLE = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49";

const LOOK = `npx autonomo-sdk find "wallet holdings"
npx autonomo-sdk risk ${TOKEN_EXAMPLE} --dry-run`;

const KEY = `# macOS and Linux
export AUTONOMO_WALLET_KEY=0x…

# Windows PowerShell
$env:AUTONOMO_WALLET_KEY = "0x…"`;

// What a user says to an agent that has Oak 0.4.1 or newer. Oak's own Autonomo guide takes it from there, with a yes at each step.
const OAK_INSTALL = `npm install -g @oakagentkit/addon`;

const OAK_ASK = `Set me up to use Autonomo.

# later, when the paying wallet runs low
Top up my Autonomo wallet with 1 USDG.`;

const PAY = `npx autonomo-sdk risk ${TOKEN_EXAMPLE}`;

const PAY_OUTPUT = `Risk Checker costs 0.01 USDG or 100 AUTONOMO or 0.01 USDC on Base. Pay from 0x…? [y/N] y
{ "token": "0x86b5…", "risk": { "level": "low", … }, … }
Paid 0.01 USDG to Risk Checker. Today: 0.01 of 5 USDG and USDC.
https://robinhoodchain.blockscout.com/tx/0x…`;

export default function QuickstartPage() {
  // Where to go next: the tools and frameworks, without the Overview and the CLI this page already used.
  const next = [...group("Build an agent"), ...group("Frameworks")].filter((i) => !["/docs/agents", "/docs/cli"].includes(i.href));

  return (
    <Page title="Your first paid call">
      <p>
        Three steps from your terminal, with the <Link href="/docs/cli">CLI</Link>. The first costs nothing and needs no
        wallet. You need Node.js 20 or newer.
      </p>
      <p className="text-sm text-muted">
        No terminal? Ask the <Link href="/playground">Agent Playground</Link> a question and watch an agent pay for the
        answer.
      </p>

      <Section id="try" title="1. Try it free">
        <p>
          The first command searches the APIs. The second shows what a Risk Checker call would cost, without paying.
        </p>
        <Code code={LOOK} lang="bash" />
      </Section>

      <Section id="wallet" title="2. Give your agent a wallet">
        <p>
          Create a <b>new wallet just for this</b> and send it a little USDG on {TOKEN.chainName}. Keep only what it may
          spend in it: most calls cost 0.01 USDG, so a dollar covers about 100. USDC on Base works too, at the same
          price: the wallet has the same address on both chains, and a call pays with whichever it holds. Then set its
          key:
        </p>
        <Code code={KEY} lang="bash" />
        <p>
          <code>npx autonomo-sdk wallet</code> shows what it holds on each chain.
        </p>
        <p className="text-sm text-muted">
          The key stays on your computer and only signs payments. It is read from <code>AUTONOMO_WALLET_KEY</code>, never
          from a flag, so it stays out of your shell history.
        </p>

        <h3 id="oak" className="scroll-mt-6 pt-2 font-medium">
          Or fund it from chat, with Oak
        </h3>
        <p>
          <a href="https://oakagentkit.org" target="_blank" rel="noopener noreferrer">
            Oak Agent Kit
          </a>{" "}
          is a local wallet for AI agents such as Claude Code, Codex and Cursor. Its key stays on your computer, and it
          shows every action in chat and waits for your yes. Since version 0.4.1 it has its own Autonomo guide, so if your
          money sits in an Oak wallet, your agent can get the USDG and top up the paying wallet for you.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Install Oak (it needs Node.js 22.12 or newer) and connect it to your agent with{" "}
            <a href="https://oakagentkit.org/setup.html" target="_blank" rel="noopener noreferrer">
              its own guide
            </a>
            :
          </li>
        </ol>
        <Code code={OAK_INSTALL} lang="bash" />
        <ol start={2} className="list-decimal space-y-1.5 pl-5">
          <li>Create the new paying wallet yourself, as above, and copy its address.</li>
          <li>Ask your agent:</li>
        </ol>
        <Code code={OAK_ASK} lang="ask your agent" />
        <p>Your agent then walks you through it, and asks for your yes before each step:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>Get USDG.</b> It swaps from ETH on {TOKEN.chainName}, or bridges in from Base. Keep a little ETH there for
            gas.
          </li>
          <li>
            <b>Set up an Oak identity, the first time only.</b> Oak needs an on-chain agent identity (ERC-8004) before it
            can send. It costs only gas, and its profile is public. This is Oak&apos;s rule, not Autonomo&apos;s.
          </li>
          <li>
            <b>Send the top-up.</b> It asks only for the paying wallet&apos;s address, never its key, and suggests a small
            amount, about 1 USDG. It never refills the wallet on its own.
          </li>
        </ul>
        <p>
          <b>Never paste your Oak key into <code>AUTONOMO_WALLET_KEY</code>.</b> The Oak wallet holds your money. The
          paying wallet is a separate one that holds only what your agent may spend on calls, and pays for them without
          asking each time, within the limits below.
        </p>
        <p className="text-sm text-muted">
          Oak is made by the Oak team. It tops up in USDG only and takes nothing from your API calls. Its 0.25% fee on a
          swap, bridge or send is shown before your yes and added on top: sending 1 USDG costs 1.0025 USDG plus gas.
        </p>
      </Section>

      <Section id="pay" title="3. Pay for a call">
        <Code code={PAY} lang="bash" />
        <p>It shows the price and asks before paying. Then it prints the answer and a receipt:</p>
        <Code code={PAY_OUTPUT} lang="output" />
        <p>
          A call stops before anything is signed if it costs more than 0.5 USDG or USDC, or would take the day past 5
          in the two together. If
          an API fails, the payment doesn&apos;t settle, so you aren&apos;t charged. Both limits can be changed: see{" "}
          <Link href="/docs/cli#limits">Limits</Link>.
        </p>
      </Section>

      <Section id="next" title="What's next">
        <p>The same call from your own code or your agent framework:</p>
        {/* Two across when that fills the grid and three across wouldn't, as with four cards. */}
        <Cards cols={next.length % 3 !== 0 && next.length % 2 === 0 ? 2 : 3}>
          {next.map((i) => (
            <Card key={i.href} title={i.label} href={i.href} body={i.about ?? ""} />
          ))}
        </Cards>
        <p>
          Have an API of your own? <Link href="/docs/launch">Launch it from the dashboard</Link> and get paid per call.
        </p>
      </Section>
    </Page>
  );
}
