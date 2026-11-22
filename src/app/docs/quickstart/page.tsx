import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { group } from "../nav";
import { Card, Cards, Code, Page, Section } from "../ui";

export const metadata: Metadata = {
  title: "Quickstart",
  description: `Your first paid call on Autonomo in three steps: try it free from your terminal, give your agent a wallet with a little USDG on ${TOKEN.chainName}, and pay for a call.`,
};

const TOKEN_EXAMPLE = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49";

const LOOK = `npx autonomo-sdk find "wallet holdings"
npx autonomo-sdk risk ${TOKEN_EXAMPLE} --dry-run`;

const KEY = `# macOS and Linux
export AUTONOMO_WALLET_KEY=0x…

# Windows PowerShell
$env:AUTONOMO_WALLET_KEY = "0x…"`;

const PAY = `npx autonomo-sdk risk ${TOKEN_EXAMPLE}`;

const PAY_OUTPUT = `Risk Checker costs 0.01 USDG or 100 AUTONOMO. Pay from 0x…? [y/N] y
{ "token": "0x86b5…", "risk": { "level": "low", … }, … }
Paid 0.01 USDG to Risk Checker. Today: 0.01 of 1 USDG.
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
          spend in it: most calls cost 0.01 USDG, so a dollar covers about 100. Then set its key:
        </p>
        <Code code={KEY} lang="bash" />
        <p className="text-sm text-muted">
          The key stays on your computer and only signs payments. It is read from <code>AUTONOMO_WALLET_KEY</code>, never
          from a flag, so it stays out of your shell history.
        </p>
      </Section>

      <Section id="pay" title="3. Pay for a call">
        <Code code={PAY} lang="bash" />
        <p>It shows the price and asks before paying. Then it prints the answer and a receipt:</p>
        <Code code={PAY_OUTPUT} lang="output" />
        <p>
          A call stops before anything is signed if it costs more than 0.05 USDG, or would take the day past 1 USDG. If
          an API fails, the payment doesn&apos;t settle, so you aren&apos;t charged. Both limits can be changed: see{" "}
          <Link href="/docs/cli#limits">Limits</Link>.
        </p>
      </Section>

      <Section id="next" title="What's next">
        <p>The same call from your own code or your agent framework:</p>
        <Cards>
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
