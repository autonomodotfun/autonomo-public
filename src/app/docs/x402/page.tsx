import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Page, Section } from "../ui";

export const metadata: Metadata = {
  title: "How x402 works",
  description:
    "x402 puts the payment inside a normal HTTP request: the API answers 402 with its price, the agent signs a payment and calls again, and the payment settles on-chain.",
};

export default function X402Page() {
  return (
    <Page title="How x402 works">
      <p>
        x402 uses the HTTP status code <code>402 Payment Required</code>. The payment happens inside a normal HTTP
        request, so an agent needs no API key, account or invoice: just a wallet.
      </p>

      <Section id="the-four-steps" title="The four steps">
        <ol className="list-decimal space-y-2 pl-5">
          <li>The agent calls an API.</li>
          <li>
            The API answers <code>402</code> with the price, the network and the wallet to pay.
          </li>
          <li>The agent signs a payment and calls again with it attached.</li>
          <li>The payment settles on-chain and the API returns the data.</li>
        </ol>
        <p>
          Prices can be fractions of a cent, so per-call pricing works for data, AI and tools that would never justify a
          subscription.
        </p>
      </Section>

      <Section id="on-autonomo" title="On Autonomo">
        <p>
          Every API launched here sits behind a gateway that does steps 2 and 4: it quotes the price in USDG or{" "}
          {TOKEN.symbol} on {TOKEN.chainName}, checks the payment and forwards the request to the API. Autonomo settles
          the payment on-chain and pays the gas. If the API fails, the payment doesn&apos;t settle, so the agent
          isn&apos;t charged.
        </p>
        <p>
          You don&apos;t have to write steps 1 to 3 yourself. The <Link href="/docs/sdk">SDK</Link>, the{" "}
          <Link href="/docs/cli">CLI</Link> and the <Link href="/docs/agents#mcp">MCP server</Link> do them within a
          per-call cap and a daily budget. To see it happen, follow the <Link href="/docs/quickstart">quickstart</Link>.
          To build it yourself, see <Link href="/docs/agents#code">Pay from your own code</Link>.
        </p>
      </Section>
    </Page>
  );
}
