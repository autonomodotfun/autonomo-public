import type { Metadata } from "next";
import Link from "next/link";
import { burnPercent } from "@/lib/burn";
import { TOKEN } from "@/lib/constants";
import { privyEnabled } from "@/lib/privy";
import { verifiedAmount, verifiedEnabled } from "@/lib/verified";
import { Shot } from "../ui";

export const metadata: Metadata = {
  title: "Launch an API from the dashboard",
  description: "Step by step: put your API behind an Autonomo gateway, set a price per call, test it and get it listed so AI agents find it.",
};

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun").replace(/\/+$/, "");
const HOST = SITE.replace(/^https?:\/\//, "");

export default function LaunchGuidePage() {
  const burn = burnPercent();
  return (
    <article className="min-w-0 max-w-3xl">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">Guide</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">Launch an API from the dashboard</h1>

      <div className="docs-body mt-6 space-y-4">
        <p>
          You already have an API. Autonomo puts a gateway in front of it: agents call the gateway, pay per call in USDG
          or {TOKEN.symbol} on {TOKEN.chainName}, and the gateway forwards each paid request to your API. You don&apos;t
          change your code, and launching is free.
        </p>
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
          <Card title="Launch" body="Sign in, paste your API's URL and set a price. Takes a few minutes." />
          <Card title="Test" body="Check the gateway answers 402 with your price, then watch paid calls arrive." />
          <Card title="Get listed" body="Request a listing so agents find your API in the directory and in searches." />
        </div>

        <Section title="Before you start">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              An API that&apos;s public and uses <code>https</code>, with a base URL like{" "}
              <code>https://api.example.com/v1</code>. No query string, and it must not redirect.
            </li>
            <li>If your API needs a key, have the header name (for example <code>X-API-Key</code>) and the key ready.</li>
            <li>
              {privyEnabled()
                ? "An email address, a Google or X account, or a wallet to sign in with. If you don't have a wallet, one is created for your earnings."
                : `A wallet that works on ${TOKEN.chainName}. You sign in with it and it gets paid.`}
            </li>
            <li>A price in mind. The official Autonomo APIs charge 0.01 USDG per call, for comparison.</li>
          </ul>
        </Section>

        <Section title="Launch it">
          <Step n={1} title="Sign in to the dashboard">
            <p>
              Open the <Link href="/dashboard">dashboard</Link> and sign in
              {privyEnabled() ? " with email, Google, X or a wallet. You can also sign in directly with a browser wallet." : " with your wallet."}{" "}
              Your APIs get paid at the wallet you sign in with, so keep using the same one.
            </p>
            <Shot src="/docs/launch/1-sign-in.png" width={1100} height={496} alt="The dashboard sign-in screen with a Sign in button" caption="The dashboard before you sign in." />
          </Step>
          <Step n={2} title="Choose Launch an API">
            <p>
              Choose <b>Launch an API</b> at the top of the dashboard. The form has three short steps: your API, your
              price, then a review before you launch.
            </p>
            <Shot src="/docs/launch/2-dashboard.png" width={1100} height={612} alt="The dashboard listing your APIs, with a Launch an API button" caption="Your dashboard. Launch an API is at the top right; your APIs are listed below." />
          </Step>
          <Step n={3} title="Step 1: name it and pick its paid address">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>API name:</b> what people and agents see, for example <i>Weather Forecasts</i>.</li>
              <li>
                <b>Your paid address:</b> filled in from the name, and you can change it: 3 to 40 lowercase letters, numbers or
                dashes. Agents call <code>{HOST}/x/your-api/…</code>, and it can&apos;t be one that&apos;s already taken.
              </li>
              <li>
                <b>What does it do?</b> One or two plain sentences. Agents read this in the payment answer to decide whether
                to pay, so say what comes back, such as &ldquo;7-day forecast for any city, as JSON.&rdquo;
              </li>
            </ul>
          </Step>
          <Step n={4} title="Still step 1: connect your API">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b>Your API&apos;s address:</b> where your API lives today, and where paid requests go. A call to <code>/x/your-api/forecast?city=Lisbon</code>{" "}
                is forwarded to <code>&lt;your API&apos;s address&gt;/forecast?city=Lisbon</code>, with the same method and body.
              </li>
              <li>
                <b>Your API key, if it needs one</b> (optional): enter the header name your API reads the key from, and
                the key. The key is encrypted, added to every forwarded call and never shown again, so agents never see it.
              </li>
            </ul>
            <p>
              Then choose <b>Test my API</b>. Autonomo makes one free call to your API, the way a paid call would reach it,
              and shows you what came back. Add a path your API serves, such as <code>/forecast?city=Lisbon</code>, to see
              a real answer. Your API has to answer before you can move on: if it refuses the call, check the key, and
              if it doesn&apos;t answer at all, check that it&apos;s running and that the address starts with https.
            </p>
          </Step>
          <Step n={5} title="Step 2: set the price per call">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>USDG:</b> a price in dollars, from $0.000001 to $100 per call. USDG payments are one signature for the agent. With a USDG price, your API also accepts <Link href="/docs/gloam">private payments through Gloam</Link>, with nothing to set up.</li>
              <li>
                <b>{TOKEN.symbol}:</b> tick it and enter how many tokens per call. Agents approve Permit2 once before their
                first {TOKEN.symbol} payment.
              </li>
            </ul>
            <p>
              Accept one or both. Accepting both lets more agents pay you.
              {burn
                ? ` ${burn}% of each payment is burned and you get the other ${100 - burn}%. Autonomo keeps none of it.`
                : " Payments go straight to your wallet, and Autonomo takes no cut."}
            </p>
            <Shot src="/docs/launch/3-launch-form.png" width={656} height={976} narrow alt="The launch form filled in for an example Weather Forecasts API priced at $0.005 USDG or 50 $AUTONOMO per call" caption="The launch form, filled in for an example API." />
          </Step>
          <Step n={6} title="Step 3: review and choose Launch API">
            <p>
              It takes a few seconds while the URL is checked. Then you land on your API&apos;s page with &ldquo;Your API is
              live&rdquo; and its gateway URL, ready to copy. If something needs fixing, the form says what next to the field.
            </p>
            <Shot src="/docs/launch/4-live.png" width={1008} height={447} alt="The API page after launch, showing Your API is live, the gateway URL and earnings" caption="Right after launch: the gateway URL to share, and your earnings so far." />
          </Step>
        </Section>

        <Section title="Check that it works">
          <Step n={7} title="See the price">
            <p>Call your gateway without paying. It should answer <code>402 Payment Required</code> with your price:</p>
            <pre className="overflow-x-auto rounded-lg border border-line bg-surface p-4 font-mono text-[13px]">
              curl -i {SITE}/x/your-api/
            </pre>
            <p>
              The same command, with your gateway URL, is under <b>Try it</b> on your API&apos;s page. Add the path your API
              expects after the slash.
            </p>
            <Shot src="/docs/launch/5-try-it.png" width={1008} height={153} alt="The Try it box with a curl command for the gateway" caption="The Try it box on your API's page." />
          </Step>
          <Step n={8} title="Make a paid call">
            <p>
              Pay for one call with any x402 client, such as the example in <Link href="/docs/agents#code">Pay from your own code</Link>{" "}
              or the <Link href="/docs/agents#mcp">MCP server</Link>. It appears under <b>Recent payments</b> on your API&apos;s page
              with the payer, what you earned and a link to the transaction.
            </p>
            <p>
              A payment only settles when your API answers successfully, with a status below 400. If your API fails, the
              agent isn&apos;t charged, and the call shows as not settled on your chart.
            </p>
          </Step>
        </Section>

        <Section title="Get listed">
          <Step n={9} title="Request a listing">
            <p>
              Your gateway works as soon as it&apos;s launched, but only people you give the URL to can find it. To be
              found, choose <b>Request listing</b> under <b>Catalog listing</b> on your API&apos;s page. Once approved, it
              gets a project page in the <Link href="/projects">directory</Link> and appears in{" "}
              <Link href="/api-docs">/api/v1/gateways</Link>, which agents and the Autonomo MCP server search.
            </p>
            <Shot src="/docs/launch/6-listing.png" width={288} height={143} narrow alt="The Catalog listing box with a Request listing button" caption="Catalog listing, on the right of your API's page." />
          </Step>
          <Step n={10} title="Wait for review">
            <p>Listings are reviewed by hand. The box on your API&apos;s page shows where it&apos;s at:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Waiting for review:</b> your request is in the queue.</li>
              <li><b>Listed:</b> agents can now find your API.</li>
              <li><b>Not approved:</b> update the name, description or API, then request again.</li>
            </ul>
            <p>
              What helps: a working API, a clear name, and a description that says exactly what an agent gets for its
              payment.
            </p>
          </Step>
        </Section>

        <Section title="Getting paid">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              {burn ? (
                <>
                  Payments are settled by the <a href="#burn">burn splitter contract</a>: every paid call goes to your own
                  splitter, which sends {100 - burn}% to your wallet and burns {burn}%, usually within a day. Your dashboard
                  shows your share.
                </>
              ) : (
                "Payments go straight to your wallet, settled on-chain with each call."
              )}{" "}
              Autonomo settles every payment on {TOKEN.chainName} itself and pays the gas.
            </li>
            <li>
              Your API&apos;s page shows paid calls, USDG and {TOKEN.symbol} earned over 30 days and all time, how many paid
              attempts settled, a 14-day chart and every recent payment.
            </li>
            <li>
              Want your earnings in a multisig? See <Link href="/docs/safe">Get paid at a Safe</Link>.
            </li>
            {verifiedEnabled() && (
              <li>
                Hold about {verifiedAmount()} of {TOKEN.symbol} in the wallet your APIs pay and they show a Verified badge.
                The tokens stay yours. <Link href="/docs/token#verified">More on Verified</Link>.
              </li>
            )}
          </ul>
          {burn && (
            <div id="burn" className="scroll-mt-6 space-y-2 rounded-lg border border-line bg-surface p-4">
              <h3 className="font-medium">How the {burn}% burn works</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>
                  Agents pay your own <b>splitter contract</b>, not your wallet directly. Nobody can take money out of it
                  except by splitting it the fixed way, and the {burn}% rate can&apos;t be changed.
                </li>
                <li>
                  When it splits, {100 - burn}% goes to your wallet. Of the rest, <b>{TOKEN.symbol}</b> is burned straight
                  away, and <b>USDG</b> goes to a buyback contract that buys {TOKEN.symbol} with it and burns that.
                </li>
                <li>
                  It splits as soon as a payment takes it to 1,000 {TOKEN.symbol} or 0.10 USDG, and a daily run also splits
                  anything from 100 {TOKEN.symbol}. Less than 0.10 USDG waits until more payments arrive.
                </li>
                <li>
                  Every burn is public: see the <Link href="/burn">burn page</Link> for each receipt, and{" "}
                  <Link href="/docs/token#burn">the full details</Link> for the contract addresses.
                </li>
              </ul>
            </div>
          )}
        </Section>

        <Section title="Managing your API">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>Edit:</b> change the name, description, your API&apos;s address, key or price under <b>Settings</b> on your API&apos;s page.
              Changes apply to the very next call. Leave the key blank to keep the saved one.
            </li>
            <li>
              <b>Pause:</b> choose <b>Pause</b> and the gateway answers <code>503</code> without charging anyone, until you
              choose <b>Resume</b>.
            </li>
            <li>
              <b>Delete:</b> type the gateway name to confirm. The gateway URL stops working at once.
            </li>
          </ul>
        </Section>

        <Section title="Limits">
          <ul className="list-disc space-y-1 pl-5">
            <li>Requests up to 1 MB and responses up to 5 MB.</li>
            <li>Your API has 25 seconds to answer.</li>
            <li>GET, POST, PUT, PATCH and DELETE are forwarded. Redirects aren&apos;t followed.</li>
            <li>Your API must stay on https and resolve to a public address. This is checked on every call.</li>
          </ul>
        </Section>

        <Section title="Questions">
          <dl className="divide-y divide-line border-y border-line">
            {FAQ.map(([q, a]) => (
              <div key={q} className="py-4">
                <dt className="font-medium">{q}</dt>
                <dd className="mt-1 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </article>
  );
}

const FAQ: [string, React.ReactNode][] = [
  ["Does launching cost anything?", <>No. Launching a gateway and getting listed are free.</>],
  [
    "Do I need to change my API?",
    <>No. Agents pay the gateway, and your API receives normal requests with your key added. It never handles payments.</>,
  ],
  [
    "Can I launch more than one API?",
    <>Yes. Each gets its own gateway URL, price and page, and they all show on your dashboard.</>,
  ],
  [
    "I already run x402 on my own server. Is this for me?",
    <>
      You don&apos;t need a gateway. Request a listing through the <Link href="/submit">listing form</Link> instead.
    </>,
  ],
  [
    "Where do I get help?",
    <>
      Ask on <a href="https://t.me/autonomodotfun">Telegram</a> or <a href="https://x.com/useautonomo">X</a>.
    </>,
  ],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 pt-8">
      <h2 className="heading text-2xl">{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 pt-1">
      <h3 className="flex items-baseline gap-2 font-medium">
        <span className="font-mono text-xs text-accent">{String(n).padStart(2, "0")}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-bg p-4">
      <span className="font-medium text-ink">{title}</span>
      <span className="mt-1 block text-sm text-muted">{body}</span>
    </div>
  );
}
