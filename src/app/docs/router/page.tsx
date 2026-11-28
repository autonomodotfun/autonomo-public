import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { CAPABILITIES, CAPABILITY_INPUTS, type Capability } from "@/lib/router/router";
import { OFFICIAL_ROUTES } from "@/lib/router/router-apis";
import { Code, Page, Section, Step, Table } from "../ui";

export const metadata: Metadata = {
  title: "The Router",
  description:
    "Ask Autonomo for a service, such as a token's risk or a swap quote, and it picks the API. You pay that API's own price, and only for an answer that passed a check. Every status and header, with a complete tested example.",
};

// The example is the file next to this page, shown as it is. It is read when the site is built, and route.test.ts
// runs that same file against a stand-in router, so what is on the page is what was tested.
export const dynamic = "force-static";
const example = readFileSync(join(process.cwd(), "src", "app", "docs", "router", "route.mjs"), "utf8").replace(/\r\n/g, "\n").trimEnd();

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
const TOKEN_ADDRESS = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const ASKED = `${SITE}/route/token-risk?token=${TOKEN_ADDRESS}`;

// What each service is for, and the inputs it takes besides the ones it needs. The needed inputs and the answer's
// fields come from the router's own lists, so they can't drift from it.
const SERVICES: Record<Capability, { what: string; optional?: string[] }> = {
  "token-price": { what: "The live price of a token, in dollars.", optional: ["chain"] },
  "token-risk": { what: "A rug-risk score for a token, with the reasons behind it.", optional: ["chain"] },
  "token-holders": { what: "Who holds a token: the top holders, wallets that look linked, and snipers.", optional: ["chain"] },
  "website-check": { what: "A trust check of a website: its domain, its certificate and what stands out." },
  "swap-quote": { what: "A checked quote for a swap. To build the swap, call the API that quoted it directly: only that API can build its own quote.", optional: ["slippage_bps"] },
  "dev-wallet": { what: "What a token's creator did with it.", optional: ["chain"] },
  "payment-check": { what: "Whether a payment in a transaction went through.", optional: ["chain"] },
  "job-finder": { what: "Open jobs an agent can take." },
};
const served = new Set(Object.values(OFFICIAL_ROUTES).map((r) => r.capability));

const ASK = `curl -i "${ASKED}"`;

const PICKED = `HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <the price list, base64>
X-Autonomo-Route-Id: Zk3vQ1b8...
X-Autonomo-Routed-To: token-risk

{
  "x402Version": 2,
  "accepts": [ { "scheme": "exact", "network": "eip155:4663", "amount": "10000", "payTo": "0x...", "...": "..." } ],
  "resource": { "...": "..." },
  "route_id": "Zk3vQ1b8...",
  "routed_to": "token-risk"
}`;

const PAY = `curl -i "${ASKED}" \\
  -H "PAYMENT-SIGNATURE: <your signed payment, base64>" \\
  -H "X-Autonomo-Route-Id: Zk3vQ1b8..."`;

const ANSWER = `HTTP/1.1 200 OK
PAYMENT-RESPONSE: <the receipt, base64>
X-Autonomo-Routed-To: token-risk
X-Autonomo-Bonded: false

{
  "score": 12,
  "level": "low",
  "flags": [],
  "raw": { "...the API's whole answer, as it gave it...": "" }
}`;

const FAILED = `HTTP/1.1 502 Bad Gateway
X-Autonomo-Route-Id: p9Xc2LrT...
X-Autonomo-Routed-To: another-risk-api

{
  "error": "token-risk failed (status 500), nothing was charged",
  "next": {
    "x402Version": 2,
    "accepts": [ { "...": "the next API's own price and address" } ],
    "route_id": "p9Xc2LrT...",
    "routed_to": "another-risk-api"
  }
}`;

const NOT_READY = `HTTP/1.1 503 Service Unavailable
Retry-After: 20
X-Autonomo-Route-Id: Hm4tW7yQ...

{
  "error": "safe-swap is not ready yet, nothing was charged: call again in 20 seconds",
  "retry_after_seconds": 20,
  "next": { "...": "the same API's price list", "route_id": "Hm4tW7yQ...", "routed_to": "safe-swap" }
}`;

const RUN = `npm install viem
AUTONOMO_WALLET_KEY=0x... node route.mjs token-risk token=${TOKEN_ADDRESS}`;
const RUN_MORE = `# another service, with two inputs
AUTONOMO_WALLET_KEY=0x... node route.mjs token-price token=${TOKEN_ADDRESS} chain=robinhood

# paying with USDC on Base
PAY_NETWORK=eip155:8453 AUTONOMO_WALLET_KEY=0x... node route.mjs website-check url=https://example.com`;

const code = (names: readonly string[]) =>
  names.map((name, i) => (
    <span key={name}>
      {i > 0 && ", "}
      <code>{name}</code>
    </span>
  ));

export default function RouterGuidePage() {
  const names = Object.keys(SERVICES) as Capability[];
  const rows = [...names.filter((n) => served.has(n)), ...names.filter((n) => !served.has(n))].map((name): [React.ReactNode, React.ReactNode] => [
    name,
    <>
      {SERVICES[name].what}
      <span className="mt-1 block text-xs">
        {CAPABILITY_INPUTS[name].length > 0 ? <>Needs {code(CAPABILITY_INPUTS[name])}. </> : <>Needs no input. </>}
        {SERVICES[name].optional && <>Also takes {code(SERVICES[name].optional!)}. </>}
        Answers {code(Object.keys(CAPABILITIES[name]))}.{!served.has(name) && <> No API serves it yet.</>}
      </span>
    </>,
  ]);

  return (
    <Page title="The Router">
      <p>
        With the Router you ask for a service, not an API. You say what you need, such as a token&apos;s risk, and Autonomo
        picks the API with the best record for it. You pay that API&apos;s own price, and the payment only goes through
        once its answer has passed a check. If the API fails, you are not charged and you are handed the next one.
      </p>
      <p>
        It is one address, <code>{SITE}/route/&lt;service&gt;</code>, and it speaks the same x402 payment as every API here.
        So anything that can <Link href="/docs/http">pay over plain HTTP</Link> can use it: the only new things are a
        route id and three answers to handle.
      </p>

      <Section id="today" title="Where it stands">
        <p>
          The Router is switched on. An API is only picked once it has a record: its last 20 measured calls, with at
          least 95% of them answered properly. A service whose APIs are still building that record answers{" "}
          <code>503</code> with <code>no API can serve this right now</code>. That costs nothing, and you can call the API
          directly meanwhile: every one is on the <Link href="/docs/official-apis">official APIs</Link> page.
        </p>
      </Section>

      <Section id="services" title="The services">
        <p>
          The service goes in the path and its inputs in the query. <code>chain</code> is <code>robinhood</code> (the
          default) or <code>base</code>. An unknown service answers <code>404</code> with this list.
        </p>
        <Table mono rows={rows} />
        <p className="text-sm text-muted">
          An API may name its fields its own way, so the Router puts the standard fields above at the top of the answer
          and the API&apos;s whole answer beside them, under <code>raw</code>. Nothing is left out.
        </p>
      </Section>

      <Section id="steps" title="A call, step by step">
        <Step n={1} title="Ask">
          <p>Send the request with no payment.</p>
          <Code code={ASK} lang="bash" />
          <p>
            The Router picks an API and answers <code>402</code> with that API&apos;s price list, exactly as the API
            would send it, and a <b>route id</b>. The price and the address to pay are the API&apos;s own.
          </p>
          <Code code={PICKED} lang="http" />
        </Step>
        <Step n={2} title="Pay the API that was picked">
          <p>
            Sign a payment for one option on that price list, the way the{" "}
            <Link href="/docs/http">plain HTTP guide</Link> shows. Then send the same request again with the payment and
            the route id.
          </p>
          <Code code={PAY} lang="bash" />
          <p>
            A route id works once and for 60 seconds, so pay right after you get it. A client that can&apos;t send the
            route id still works: the Router finds the route from the request and the API the payment is made out to.
          </p>
        </Step>
        <Step n={3} title="Read the answer">
          <p>
            The Router calls the API, checks that the answer has every field the service promises, and only then lets
            the payment through. <code>X-Autonomo-Routed-To</code> names the API that answered.{" "}
            <code>X-Autonomo-Bonded</code> says whether its creator has a <Link href="/bond">bond</Link> locked.
          </p>
          <Code code={ANSWER} lang="http" />
        </Step>
      </Section>

      <Section id="answers" title="The three answers to handle">
        <p>
          <b>The API failed.</b> A <code>502</code> with <code>next</code>: nothing was charged, and <code>next</code> is
          the price list and route id of another API. Sign a new payment for it, since each API is paid at its own
          address, and send the request again. After three APIs the Router stops and says so.
        </p>
        <Code code={FAILED} lang="http" />
        <p>
          <b>The API isn&apos;t ready yet.</b> A <code>503</code> with <code>Retry-After</code> and <code>next</code>:
          nothing was charged. Wait the seconds it names, at most two minutes, then pay <code>next</code>, which is the
          same API. Coming back early only gets the same answer.
        </p>
        <Code code={NOT_READY} lang="http" />
        <p>
          <b>Nothing can serve it.</b> A <code>503</code> with no <code>next</code>, on the very first request: no API
          has the record to be picked yet. Call an API directly, or try later.
        </p>
        <Table
          mono
          rows={[
            ["200", "A checked answer. The payment went through."],
            ["400", "An input is missing (the answer lists the inputs), or the route id is unknown, used or older than 60 seconds: ask again."],
            ["402", "With no payment: the price list and a route id. After a payment: it wasn't valid, and a new route id for the same API comes with it."],
            ["403", "This wallet is paused for 24 hours, because an earlier payment of its own could not be collected after the answer was ready."],
            ["404", "No such service. The answer lists them all."],
            ["429", "Too many requests: 240 a minute from one address, or 60 paid calls a minute from one wallet. Wait a minute."],
            ["502", "The API failed and nothing was charged. With next: pay the next API. Without it: no other API is left."],
            ["503", "With next: the API isn't ready, wait and pay again. Without it: no API can serve this service right now."],
          ]}
        />
      </Section>

      <Section id="example" title="The whole thing in one file">
        <p>
          About 130 lines, with one package for signing. It asks, pays the API that was picked, moves to the next one
          when an API fails, waits when one isn&apos;t ready, and stops after three tries. It refuses any price over 50
          cents and any token other than the one named in it.
        </p>
        <Code code={RUN} lang="bash" />
        <Code code={example} lang="route.mjs" />
        <Code code={RUN_MORE} lang="bash" />
        <p>
          It prints the answer, the API that gave it, the price and the transaction. On a failure it prints what the
          Router said and exits with a code other than 0, so an agent can tell the two apart.
        </p>
        <p className="text-sm text-muted">
          This file is tested on every change to this site, against a stand-in that answers as the Router does: the
          picked API, a failed one, one that isn&apos;t ready, and none at all. The payment it sends is compared, field
          for field, with what the official x402 client sends.
        </p>
      </Section>

      <Section id="rules" title="What you can rely on">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>You pay the API&apos;s own price.</b> The Router adds nothing, and the money goes where a direct call
            would send it.
          </li>
          <li>
            <b>A bad answer is never charged.</b> The payment only goes through after the answer passed the check. A
            failed API, a slow one, one that isn&apos;t ready and one whose answer is missing a field all cost nothing.
          </li>
          <li>
            <b>Every try needs its own signature.</b> A payment is made out to one API&apos;s address, so it can&apos;t be
            reused for the next one, and nobody can redirect it.
          </li>
          <li>
            <b>Keep your own limit.</b> The API names the price, so check it before signing, as the example does.
          </li>
          <li>
            <b>A wallet that can&apos;t pay is paused.</b> If the answer was ready and the payment then failed because
            the money or the signature was gone, that wallet is refused for 24 hours.
          </li>
          <li>
            <b>What is kept from a call.</b> The token address or transaction hash of a paid call may be used again later
            to test APIs with real inputs. Websites, wallets and swap details are never reused.
          </li>
        </ul>
      </Section>

      <Section id="picking" title="How an API is picked">
        <p>
          Each API has a score from its record: how often its answers passed the check (60%), how fast it answers (30%)
          and whether it is up (10%). The record comes from real routed calls and from regular test calls Autonomo
          makes itself. The best score is picked, and APIs within 10% of it share the calls. An API under 95% good
          answers is left out until its record recovers, and so is one whose answers stop matching the service&apos;s
          fields.
        </p>
      </Section>

      <Section id="more" title="When you want more">
        <p>
          The <Link href="/docs/sdk">SDK</Link>, the <Link href="/docs/cli">CLI</Link> and the MCP server call APIs
          directly today and don&apos;t use the Router yet. To pick an API yourself, the free discovery API is on the{" "}
          <Link href="/api-docs">API reference</Link>, and the official APIs are described in one file at{" "}
          <a href={`${SITE}/openapi.json`}>/openapi.json</a>.
        </p>
      </Section>
    </Page>
  );
}
