import type { Metadata } from "next";
import Link from "next/link";
import { Code, Page, Section, Step } from "../ui";

export const metadata: Metadata = {
  title: "Run x402 on your own server",
  description: "Add x402 to your own API server, check that it answers 402, and get it listed on Autonomo.",
};

// Seller example follows the x402 seller quickstart (docs.x402.org), on testnet.
const SELLER_INSTALL = "npm install @x402/express @x402/core @x402/evm";

const SELLER_CODE = `import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
const payTo = "0xYourWalletAddress"; // where payments land

// Testnet facilitator (Base Sepolia). Switch to a mainnet facilitator to go live.
const facilitator = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:84532", payTo }],
        description: "Current weather for a city",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitator).register("eip155:84532", new ExactEvmScheme()),
  ),
);

app.get("/weather", (req, res) => {
  res.json({ city: "Lisbon", weather: "sunny", tempC: 24 });
});

app.listen(4021);`;

const SELLER_TEST = `curl -i http://localhost:4021/weather
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: <price, network and payTo, base64-encoded>`;

export default function SelfHostedPage() {
  return (
    <Page title="Run x402 on your own server">
      <p>
        Most people don&apos;t need this: a <Link href="/docs/launch">hosted gateway</Link> puts any API behind x402 with no
        code. Use this guide if you want x402 inside your own server, on any network your facilitator supports.
      </p>

      <Section title="Set it up">
        <Step n={1} title="Add x402 to your server">
          <p>Install the middleware for your framework. This example uses Express; Next.js, Hono, Fastify, Go and Python work the same way.</p>
          <Code code={SELLER_INSTALL} lang="bash" />
          <Code code={SELLER_CODE} lang="ts" />
          <p>
            This runs on Base Sepolia, a testnet, so you can try it without real money. To go live, switch to a mainnet
            network (Base is <code>eip155:8453</code>) and a mainnet facilitator, as described in the{" "}
            <a href="https://docs.x402.org/getting-started/quickstart-for-sellers">x402 seller quickstart</a>.
          </p>
        </Step>
        <Step n={2} title="Check that it answers 402">
          <Code code={SELLER_TEST} lang="bash" />
        </Step>
      </Section>

      <Section title="Get listed on Autonomo">
        <Step n={3} title="Choose how">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Automatically.</b> Register your endpoint with a facilitator that supports Bazaar discovery. Autonomo
              imports the Coinbase CDP and PayAI catalogs every 3 days, groups endpoints by host and shows price, network
              and usage.
            </li>
            <li>
              <b>Through the launch form.</b> <Link href="/submit">Request a launch</Link> with your website and a paid
              endpoint URL. Every request is reviewed by hand, and APIs with a live <code>402</code> endpoint go fastest.
            </li>
          </ul>
        </Step>
      </Section>
    </Page>
  );
}
