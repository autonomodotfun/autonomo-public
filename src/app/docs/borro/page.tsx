import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Pay with a Borro credit line",
  description: `An agent with a Borro credit line can pay Autonomo APIs without holding USDG first: it borrows just what it's short and pays in the same request, on ${TOKEN.chainName}.`,
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
const BORRO = "https://borro.markets";

const BILL_CODE = `{
  "wallet": "<the agent's wallet>",
  "account": "<the credit line's account>",
  "payment_required": "<the PAYMENT-REQUIRED header>",
  "max_usdg": "0.05"
}`;

const HEADER_CODE = `{
  "payment_required": "<the PAYMENT-REQUIRED header>",
  "authorization": "<from credit_bill>",
  "signature": "<your signature>"
}`;

// The first payment with a Borro credit line, Nov 6, 2026: a test agent with no USDG borrowed the 0.01 and paid New Launches.
const EXAMPLE_TXS = [
  { label: "Borrow", hash: "0x51ac73c11629bef02cc96b6a787e9a86def6d4892f2042b66b512e2f4580385a" },
  { label: "Payment", hash: "0x0f1635d41a8fbbde7d61ad39e045e067780b921329112c16955bc26ad3423041" },
];

export default function BorroGuidePage() {
  return (
    <Page title="Pay with a Borro credit line">
      <p>
        Autonomo APIs are paid per call with x402, in USDG on {TOKEN.chainName}. An agent with a{" "}
        <a href={BORRO}>Borro</a> credit line can pay them without holding USDG first: when its wallet is short, it borrows
        just the difference from its line and pays in the same request. The API gets paid in USDG the same as with any
        other payment.
      </p>
      <Table
        rows={[
          ["Works with", <>Autonomo APIs that accept USDG on {TOKEN.chainName}</>],
          ["The agent needs", "A wallet that can sign, and a Borro credit line with x402 bills turned on"],
          ["Tools", <>Borro&apos;s MCP server at <a href={`${BORRO}/mcp`}>borro.markets/mcp</a></>],
        ]}
      />

      <Section title="Open a credit line">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Go to <a href={`${BORRO}/app`}>borro.markets/app</a> and choose <b>Borrow</b>, then <b>an AI credit market</b>.
          </li>
          <li>Open a line for your agent&apos;s wallet.</li>
          <li>
            Tick <b>Let the agent pay its x402 bills</b> and set a <b>daily limit</b>. The agent can never spend more than
            this in a day.
          </li>
        </ol>
        <p>Note the line&apos;s account: the agent passes it to Borro&apos;s tools.</p>
      </Section>

      <Section title="How it works">
        <Step n={1} title="Call the API and get the price">
          <p>
            Call the API without a payment. It answers <code>402</code>, with a <code>PAYMENT-REQUIRED</code> header
            listing what it accepts. Keep that header as it is. USDG is listed first, and that&apos;s the option Borro pays.
          </p>
        </Step>
        <Step n={2} title="Ask Borro to prepare the payment">
          <p>
            Call <code>credit_bill</code> on Borro&apos;s MCP server. <code>max_usdg</code> is the most the agent will pay
            for this call, so set it a little above the API&apos;s price.
          </p>
          <Code code={BILL_CODE} lang="json" />
          <p>
            It returns the EIP-3009 typed data to sign. If the wallet doesn&apos;t hold enough USDG, it also returns one
            borrow transaction: send that first, and wait until the borrowed USDG is in the wallet.
          </p>
        </Step>
        <Step n={3} title="Sign">
          <p>
            Sign the typed data with the agent&apos;s wallet. Nothing is paid yet: the signature only allows this one
            payment, of this amount, to this API.
          </p>
        </Step>
        <Step n={4} title="Get the payment header">
          <p>
            Call <code>credit_bill_header</code>. It returns the header&apos;s name and value.
          </p>
          <Code code={HEADER_CODE} lang="json" />
        </Step>
        <Step n={5} title="Call the API again">
          <p>
            Send the same request with that header. The API checks the payment, answers <code>200</code> with the result,
            and the USDG is settled on-chain. Autonomo pays the gas.
          </p>
        </Step>
      </Section>

      <Section title="Example">
        <p>
          <Link href="/docs/official-apis">New Launches</Link>, one of Autonomo&apos;s official APIs, costs 0.01 USDG per
          call:
        </p>
        <Code code={`GET ${SITE}/x/new-launches/launches?limit=10`} lang="http" />
        <p>On Nov 6, 2026, a test agent with no USDG paid this API by borrowing the 0.01 on its Borro credit line:</p>
        <ul className="list-disc space-y-1 pl-5">
          {EXAMPLE_TXS.map((t) => (
            <li key={t.hash}>
              {t.label}:{" "}
              <a href={`${TOKEN.explorer}/tx/${t.hash}`} className="font-mono">
                {t.hash.slice(0, 6)}…{t.hash.slice(-4)}
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Pay after the borrow lands. If the borrowed USDG isn&apos;t visible yet, Autonomo checks the balance once more
            2 seconds later. If it&apos;s still short, the payment is refused and nobody is charged, so the agent can try
            again.
          </li>
          <li>One signature pays one call. Sending the same payment again is refused.</li>
          <li>If the API fails, the agent isn&apos;t charged: the payment only settles when the API answers properly.</li>
          <li>
            The credit is Borro&apos;s. The credit line, its limits, its costs and repaying it are between the agent&apos;s
            owner and Borro. Autonomo only sells the API calls and doesn&apos;t lend. See{" "}
            <a href={`${BORRO}/agents`}>Borro&apos;s agent docs</a> for the full tool list and how lines work.
          </li>
        </ul>
      </Section>
    </Page>
  );
}
