import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Pay privately with Gloam",
  description: `Pay any API on Autonomo that accepts USDG from a private Gloam balance on ${TOKEN.chainName}, so the payment doesn't link back to your wallet.`,
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
const GLOAM = "https://gloam.trade";

const PAY_CODE = `const url = "${SITE}/x/token-risk/risk/0x…";

// 1. Get the price. The 402 lists a "gloam-cashout" option.
const res = await fetch(url);
const { accepts } = JSON.parse(atob(res.headers.get("payment-required")));
const gloam = accepts.find((a) => a.scheme === "gloam-cashout");

// 2. Cash out exactly gloam.amount (USDG base units) to gloam.payTo
//    from your Gloam balance, within 10 minutes. Keep the tx hash.

// 3. Call again with the payment.
const paid = await fetch(url, {
  headers: {
    "X-PAYMENT": JSON.stringify({ scheme: "gloam-cashout", txHash, quoteId: gloam.extra.quoteId }),
  },
});
console.log(await paid.json());`;

export default function GloamGuidePage() {
  return (
    <Page title="Pay privately with Gloam">
      <p>
        <a href={GLOAM}>Gloam</a> lets you hold USDG privately on {TOKEN.chainName}. Every API on Autonomo that accepts
        USDG, including the <Link href="/docs/official-apis">official APIs</Link>, also accepts a Gloam cash-out as
        payment. It&apos;s sent from
        Gloam&apos;s vault through its relay, so the payment doesn&apos;t link back to your wallet. The API gets paid
        the same as with any other payment.
      </p>
      <Table
        rows={[
          ["Stays private", "Which wallet paid for the call"],
          ["Still public", "The amount, the API's payment address and the time, plus any money you add to Gloam"],
        ]}
      />

      <Section title="How it works">
        <Step n={1} title="Get the price">
          <p>
            Call the API. The <code>402</code> answer lists a <code>gloam-cashout</code> option with the exact{" "}
            <code>amount</code> to pay, the <code>payTo</code> address and a <code>quoteId</code>. The amount is the price
            plus Gloam&apos;s 0.5% cash-out fee and a tiny tag that makes it unique. Keep the <code>quoteId</code> to
            yourself until you use it.
          </p>
        </Step>
        <Step n={2} title="Cash out from Gloam">
          <p>
            Within 10 minutes, cash out exactly that amount in USDG to <code>payTo</code>, using the{" "}
            <a href={`${GLOAM}/app/vault`}>Gloam app</a>, its SDK or its MCP server. Keep the transaction hash.
          </p>
        </Step>
        <Step n={3} title="Call again with the payment">
          <p>
            Send the same request with an <code>X-PAYMENT</code> header holding the transaction hash and the quote ID, as
            JSON or base64 JSON. If it checks out, you get the answer.
          </p>
        </Step>
        <Code code={PAY_CODE} lang="ts" />
        <p>
          Gloam&apos;s own MCP server can do all three steps for an agent with its <code>gloam_fetch_paid</code> tool. See{" "}
          <a href={`${GLOAM}/docs/agents`}>Gloam&apos;s agent docs</a>.
        </p>
      </Section>

      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>Each transaction pays for one call. Sending it again is refused.</li>
          <li>If the API fails, you can retry with the same transaction while the quote lasts.</li>
          <li>A cash-out of the wrong amount, or to the wrong address, isn&apos;t accepted, and the money doesn&apos;t come back automatically.</li>
          <li>APIs priced only in {TOKEN.symbol} don&apos;t offer it, because Gloam pays in USDG.</li>
        </ul>
      </Section>
    </Page>
  );
}
