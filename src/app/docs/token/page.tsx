import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { BURN_BPS, BURN_DEAD, burnFactory, buybackBurner } from "@/lib/burn";
import { TOKEN } from "@/lib/constants";
import { verifiedAmount, verifiedEnabled } from "@/lib/verified";
import { Page, Section } from "../ui";

export const metadata: Metadata = {
  title: `${TOKEN.symbol}, burn and Verified`,
  description: `The official ${TOKEN.symbol} contract address, what the token pays for, how every paid API call burns it, and how holding it gets API providers a Verified badge.`,
};

export default function TokenPage() {
  const burn = burnFactory();
  return (
    <Page eyebrow="Docs" title={`${TOKEN.symbol}, burn and Verified`}>
      <p>The official {TOKEN.symbol} contract address is:</p>
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap select-all">{TOKEN.address}</code>
        <CopyButton text={TOKEN.address} label={`Copy ${TOKEN.symbol} contract address`} className="btn-brand shrink-0 px-3 py-1.5 text-xs" />
      </div>
      <p>
        The address is also in the bar at the top of every page. Always check it on autonomo.fun before you buy: copies
        posted elsewhere can be fake. Nothing on this site is financial advice.
      </p>

      <Section id="uses" title="What it's used for">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Paying for APIs:</b> agents pay the <Link href="/docs/official-apis">official APIs</Link>, and any hosted
            gateway whose owner accepts it, in {TOKEN.symbol} on {TOKEN.chainName}. The Agent Playground and the Telegram
            bot pay in {TOKEN.symbol}.
          </li>
          {burn && <li><b>Burns:</b> {BURN_BPS / 100}% of every paid API call is burned. See below.</li>}
          {verifiedEnabled() && <li><b>Verified:</b> API providers who hold it get a badge on their APIs. See below.</li>}
        </ul>
      </Section>

      {burn && (
        <Section id="burn" title="Burn on paid calls">
          <p>
            {BURN_BPS / 100}% of every API payment through Autonomo is burned on-chain. Each API provider is paid at their
            own splitter contract. Flushing it sends {BURN_BPS / 100}% of {TOKEN.symbol} payments to the dead address and{" "}
            {BURN_BPS / 100}% of USDG payments to the buyback contract, which buys {TOKEN.symbol} with it and sends it to the
            dead address. The provider gets the rest. The rate and addresses can&apos;t be changed, and nobody can withdraw
            the USDG waiting to be swapped. A splitter is flushed when it reaches 1,000 {TOKEN.symbol} or 0.10 USDG, and
            otherwise once a day if it holds at least 100 {TOKEN.symbol}. A buyback runs once 0.1 USDG is waiting.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Splitter factory:{" "}
              <a href={`${TOKEN.explorer}/address/${burn}`} className="font-mono break-all">
                {burn}
              </a>
            </li>
            {buybackBurner() && (
              <li>
                Buyback and burn:{" "}
                <a href={`${TOKEN.explorer}/address/${buybackBurner()}`} className="font-mono break-all">
                  {buybackBurner()}
                </a>
              </li>
            )}
            <li>
              Burns:{" "}
              <a href={`${TOKEN.explorer}/address/${BURN_DEAD}`} className="font-mono break-all">
                {BURN_DEAD}
              </a>
            </li>
          </ul>
          <p>
            Every burn is an on-chain event: <code>Flushed</code> on each splitter and <code>BoughtAndBurned</code> on the
            buyback contract. You can read each contract&apos;s source on the explorer, at the addresses above. The{" "}
            <Link href="/burn">burn page</Link> lists every receipt and the full split of each payment.
          </p>
        </Section>
      )}

      {verifiedEnabled() && (
        <Section id="verified" title="Verified for API providers">
          <p>
            Launching an API is free. Hold about {verifiedAmount()} of {TOKEN.symbol} in the wallet your APIs pay, and they
            show a Verified badge in the directory, on the dashboard and in <code>/api/v1/gateways</code>.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              The amount in tokens is set each week from the previous week&apos;s average price, rounded to the nearest
              100,000.
            </li>
            <li>
              Once you qualify, your amount is locked: it won&apos;t go up, and it moves down if the weekly amount falls below
              it.
            </li>
            <li>
              The tokens stay yours. If your balance drops below your amount, you lose the badge and the lock, and qualify
              again at the current weekly amount.
            </li>
            <li>Verified shows the provider holds the token. It isn&apos;t a review of the API.</li>
          </ul>
          <p>
            If your APIs pay a Safe, the Safe&apos;s balance is what counts: see{" "}
            <Link href="/docs/safe">Get paid at a Safe</Link>.
          </p>
        </Section>
      )}
    </Page>
  );
}
