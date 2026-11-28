import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "Pay over plain HTTP",
  description: `Pay an Autonomo API with no SDK: two HTTP requests and one signature, in USDG on ${TOKEN.chainName} or USDC on Base. Every header and field, with complete examples in JavaScript and Python.`,
};

// The examples are the two files next to this page, shown as they are. They are read when the site is built, and the
// tests in pay.test.ts run those same files, so what is on the page is what was tested.
export const dynamic = "force-static";
const example = (name: string) => readFileSync(join(process.cwd(), "src", "app", "docs", "http", name), "utf8").replace(/\r\n/g, "\n").trimEnd();

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
const API = `${SITE}/x/gas-now/gas`;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const ASK = `curl -i "${API}"`;

const PRICE_LIST = `{
  "x402Version": 2,
  "resource": { "url": "${API}", "description": "...", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:4663",
      "amount": "5000",
      "asset": "${USDG}",
      "payTo": "0x...",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "Global Dollar", "version": "1" }
    },
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "amount": "5000",
      "asset": "${USDC}",
      "payTo": "0x...",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ],
  "extensions": { "bazaar": { "...": "..." } }
}`;

const TYPED_DATA = `{
  "domain": {
    "name": "Global Dollar",            // extra.name
    "version": "1",                     // extra.version
    "chainId": 4663,                    // the number in "eip155:4663"
    "verifyingContract": "${USDG}"   // asset
  },
  "primaryType": "TransferWithAuthorization",
  "types": {
    "TransferWithAuthorization": [
      { "name": "from", "type": "address" },
      { "name": "to", "type": "address" },
      { "name": "value", "type": "uint256" },
      { "name": "validAfter", "type": "uint256" },
      { "name": "validBefore", "type": "uint256" },
      { "name": "nonce", "type": "bytes32" }
    ]
  },
  "message": {
    "from": "0x...",          // your wallet
    "to": "0x...",            // payTo
    "value": "5000",          // amount
    "validAfter": "0",
    "validBefore": "1795000300",   // now, in seconds, plus maxTimeoutSeconds
    "nonce": "0x..."          // 32 random bytes, new for every payment
  }
}`;

const PAYMENT = `{
  "x402Version": 2,
  "accepted": { ... },      // the option you chose, exactly as it came
  "resource": { ... },      // copied from the price list
  "extensions": { ... },    // copied from the price list
  "payload": {
    "authorization": {
      "from": "0x...",
      "to": "0x...",
      "value": "5000",
      "validAfter": "0",
      "validBefore": "1795000300",
      "nonce": "0x..."
    },
    "signature": "0x..."
  }
}`;

const RECEIPT = `{
  "success": true,
  "transaction": "0x...",
  "network": "eip155:4663",
  "payer": "0x..."
}`;

const RUN_JS = `npm install viem
AUTONOMO_WALLET_KEY=0x... node pay.mjs "${API}"`;

const RUN_PY = `pip install eth-account
AUTONOMO_WALLET_KEY=0x... python pay.py "${API}"`;

const RUN_BASE = `PAY_NETWORK=eip155:8453 AUTONOMO_WALLET_KEY=0x... node pay.mjs "${API}"`;

export default function HttpGuidePage() {
  return (
    <Page title="Pay over plain HTTP">
      <p>
        The <Link href="/docs/sdk">SDK</Link>, the <Link href="/docs/cli">CLI</Link> and the{" "}
        <Link href="/docs/agents#mcp">MCP server</Link> pay for you. This page is for when you can&apos;t use them: another
        language, a small runtime, or you want to see every step. A payment is two HTTP requests and one signature.
        You need nothing from Autonomo or x402, only a library that can sign typed data (EIP-712), which most Ethereum
        libraries can.
      </p>

      <Section id="need" title="What you need">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            A wallet that holds USDG on {TOKEN.chainName}, or USDC on Base. A few cents is enough: most calls cost
            a cent or less.
          </li>
          <li>No ETH. The wallet signs a message and sends no transaction, so it pays no gas.</li>
          <li>A wallet made for the agent, with a small balance. Never the wallet that holds your savings.</li>
        </ul>
      </Section>

      <Section id="steps" title="The payment, step by step">
        <Step n={1} title="Ask for the price">
          <p>
            Send the request with no payment. The API answers <code>402</code>. The price list is not in the body: it
            is in the <code>PAYMENT-REQUIRED</code> header, as base64 of a JSON text.
          </p>
          <Code code={ASK} lang="bash" />
          <p>Decoded, it looks like this (shortened):</p>
          <Code code={PRICE_LIST} lang="json" />
          <Table
            mono
            rows={[
              ["amount", "The price in the token's smallest unit. USDG and USDC have 6 decimals, so 5000 is $0.005."],
              ["asset", "The token's contract address. Check this, not a name, to know which token it is."],
              ["network", "The chain: eip155:4663 is " + TOKEN.chainName + ", eip155:8453 is Base."],
              ["payTo", "The address the payment goes to. Always take it from the header of the call you are paying for."],
              ["maxTimeoutSeconds", "How long your signature should stay valid."],
              ["extra", "The token's name and version. You need both to sign."],
            ]}
          />
        </Step>

        <Step n={2} title="Choose an option">
          <p>
            <code>accepts</code> lists every way to pay for this call. This guide covers the two that need one signature
            and nothing else:
          </p>
          <Table
            rows={[
              [`USDG on ${TOKEN.chainName}`, <>Network <code>eip155:4663</code>, asset <code>{USDG}</code>. The usual price on Autonomo.</>],
              ["USDC on Base", <>Network <code>eip155:8453</code>, asset <code>{USDC}</code>. On most Autonomo APIs, at the same dollar price.</>],
            ]}
          />
          <p>
            Pick by network and asset address, and check the price against a limit of your own before you go on. The list
            can hold other options too: {TOKEN.symbol} (marked <code>permit2</code>, which needs an approval first, see{" "}
            <Link href="/docs/agents#code">Pay from your own code</Link>) and a private payment (
            <code>gloam-cashout</code>, see <Link href="/docs/gloam">Pay privately with Gloam</Link>).
          </p>
        </Step>

        <Step n={3} title="Sign the transfer">
          <p>
            Sign this typed data with the wallet&apos;s key. It allows one transfer of exactly <code>amount</code>, to
            exactly <code>payTo</code>, until <code>validBefore</code>. Here it is filled in for the USDG option above:
          </p>
          <Code code={TYPED_DATA} lang="json" />
          <p>
            The result is a 65-byte signature, written as <code>0x</code> and 130 hex characters. The standard is
            EIP-3009, which USDG and USDC both support.
          </p>
        </Step>

        <Step n={4} title="Ask again, with the payment">
          <p>
            Build this JSON, encode it as base64 and send the same request again (same method, address and body) with it
            in the <code>PAYMENT-SIGNATURE</code> header. The numbers inside <code>authorization</code> are strings.
          </p>
          <Code code={PAYMENT} lang="json" />
        </Step>

        <Step n={5} title="Read the answer">
          <p>
            A paid call answers as the API normally would, and adds a receipt in the <code>PAYMENT-RESPONSE</code> header,
            again base64 of a JSON text. <code>transaction</code> is the payment on-chain.
          </p>
          <Code code={RECEIPT} lang="json" />
          <p>
            If the payment is refused, the answer is <code>402</code> again, with the reason in the <code>error</code> field
            of a new <code>PAYMENT-REQUIRED</code> header, for example <code>insufficient_funds</code>. Nothing was taken.
            If the API itself fails, the payment doesn&apos;t settle either, so you aren&apos;t charged.
          </p>
        </Step>
      </Section>

      <Section id="javascript" title="The whole thing in JavaScript">
        <p>
          One file, about a hundred lines, with one package for signing. It pays USDG on {TOKEN.chainName} unless told
          otherwise, and refuses any price over 50 cents.
        </p>
        <Code code={RUN_JS} lang="bash" />
        <Code code={example("pay.mjs")} lang="pay.mjs" />
        <p>To pay with USDC on Base, name the network:</p>
        <Code code={RUN_BASE} lang="bash" />
      </Section>

      <Section id="python" title="The same in Python">
        <p>The same steps with the standard library and one package for signing.</p>
        <Code code={RUN_PY} lang="bash" />
        <Code code={example("pay.py")} lang="pay.py" />
      </Section>

      <Section id="rules" title="Rules that keep the wallet safe">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Set a price limit and check it before signing.</b> The API names the price, so your code is the only thing
            that can say no.
          </li>
          <li>
            <b>Sign only for a token you chose.</b> Compare the <code>asset</code> address with one written in your code.
            The name in <code>extra</code> is only a label.
          </li>
          <li>
            <b>Use a new random nonce every time.</b> A signature works once, and a nonce that was used is refused.
          </li>
          <li>
            <b>Keep the signature short-lived.</b> Use <code>maxTimeoutSeconds</code> from the price list and no more.
          </li>
          <li>
            <b>Keep the key out of the code.</b> Read it from the environment or a secrets store, and never print it.
          </li>
        </ul>
        <p>
          Both examples follow these rules, and both are tested on every change to this site: the payment each one sends
          is compared, field for field, with what the official x402 client sends.
        </p>
      </Section>

      <Section id="more" title="When you want more">
        <p>
          The <Link href="/docs/sdk">SDK</Link> adds what these files leave out: finding an API from a description, a
          daily budget, {TOKEN.symbol} payments, private payments and credit. To find APIs yourself, the free discovery
          API is on the <Link href="/api-docs">API reference</Link>, and the official APIs are described in one file at{" "}
          <a href={`${SITE}/openapi.json`}>/openapi.json</a>.
        </p>
      </Section>
    </Page>
  );
}
