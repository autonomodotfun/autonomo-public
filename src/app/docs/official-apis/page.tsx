import type { Metadata } from "next";
import Link from "next/link";
import { shelve } from "@/lib/api-shelves";
import { TOKEN } from "@/lib/constants";
import { Page, Section, Table } from "../ui";

export const metadata: Metadata = {
  title: "Official APIs",
  description: `The APIs Autonomo runs for ${TOKEN.chainName}: token prices, new launches, rug-risk checks, creators and holders, transactions and payments, wallets, gas, website and endpoint checks, web pages and agents for hire on Ostrapad, payable per call in USDG or ${TOKEN.symbol}.`,
};

const HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// The APIs Autonomo runs itself (official-apis/tools). Each sits behind its own gateway at /x/<slug>.
const OFFICIAL_APIS: { name: string; slug: string; path: string; about: string }[] = [
  { name: "Token Price", slug: "token-price", path: "/price/autonomo", about: `The live ${TOKEN.symbol} price` },
  { name: "Token Lookup", slug: "token-lookup", path: "/price/<token>", about: "Price and market cap of any Robinhood Chain launchpad token, from its bonding curve or, after graduation, its Uniswap v4 pool" },
  { name: "New Launches", slug: "new-launches", path: "/launches?limit=10", about: "The newest launchpad tokens: age, buys, sells, market cap and curve progress" },
  { name: "Risk Checker", slug: "token-risk", path: "/risk/<token>", about: "A rug-risk score from holder concentration, the creator, launch-block buyers and bot volume" },
  { name: "Tx Explainer", slug: "tx-explainer", path: "/tx/<hash>", about: "A Robinhood Chain transaction in plain English: launches, buys, sells, transfers and fee" },
  { name: "Wallet Portfolio", slug: "wallet-portfolio", path: "/portfolio/<wallet>", about: "ETH, USDG, WETH, $AUTONOMO and every other token the wallet holds, valued in USD, with impostor tokens flagged" },
  { name: "Dev Wallet Tracker", slug: "dev-wallet", path: "/dev/<token>", about: "What a token's creator did: tokens bought, burned, locked, sold and still held, creator fees claimed and waiting, where their ETH went, who funded the wallet and other tokens they launched" },
  { name: "Holders & Bundles", slug: "holders-bundles", path: "/holders/<token>", about: "Who really holds a token: top holders with the pool and burns set apart, wallets linked by a shared funder, snipers in the first 15 seconds and what they still hold, same-block buyers and repeat snipers" },
  { name: "Payment Check", slug: "payment-check", path: "/payment/<hash>", about: "Did an x402 payment settle? Who paid whom, how much in USDG or $AUTONOMO, and who paid the gas. Add ?to=, amount= or asset= for a yes or no match on a receipt" },
  { name: "Gas Now", slug: "gas-now", path: "/gas", about: "The current gas price and what it costs in ETH and USD to send ETH, send USDG, buy on a launchpad curve or launch a token, measured from recent transactions" },
  { name: "Endpoint Health", slug: "endpoint-health", path: "/endpoint?url=<https link>", about: "Is an x402 API up and payable right now? One unpaid call reports the answer time and whether its payment request is complete: scheme, network, asset, amount and payee" },
  { name: "Website Check", slug: "website-check", path: "/site?url=<link or domain>", about: "A trust check for a website: domain age and registrar, certificate, where it redirects and whether the name imitates a well-known one, with a caution level" },
  { name: "Page Reader", slug: "page-reader", path: "/page?url=<https link>", about: "Title, description and readable text of a public web page" },
  {
    name: "Ostrapad Offer Finder",
    slug: "ostrapad-offer-finder",
    path: "/offers?q=<what you need>",
    about: "AI agents for hire on Ostrapad that match a request: price, delivery time, who judges the work and each provider's record, as Ostrapad shows them, with a link to each agent's Ostrapad page. Built on Ostrapad's public listings; not an official Ostra API",
  },
];

// The wallets the official APIs use since Nov 3, 2026, when payments and the Verified tokens moved to the Safe.
const OFFICIAL_WALLETS = [
  {
    job: "Gets paid",
    address: "0x92a99FBD386F87277b6009BFF4C56728Ec5f7354",
    about: `A 2-of-2 Safe. Every official API pays it, and it holds about 1M ${TOKEN.symbol}, including the 984,245 bought back for Verified.`,
  },
  {
    job: "Signs in",
    address: "0x0870df267e76ce27f81ea43273e152d0faefaa7a",
    about: "Manages the APIs from the dashboard. It no longer gets paid or holds the tokens.",
  },
  {
    job: "Pays gas",
    address: "0x68aa21699247a5f0b90661c50004e426507fe9f8",
    about: "Our server uses it to submit each payment on-chain, so agents don't pay gas.",
  },
];

// The first paid call from a wallet outside the team: 0.01 USDG from 0x33d6112f2f3bcd2a476bd9c13208e4c632be2d0a
// to the official API Safe.
const FIRST_OUTSIDE_PAYMENT = "0x01295eba2c428270708417f658d9a4a2f0fb08bfecd1d1229e0b0752c7bfd612";

export default function OfficialApisPage() {
  return (
    <Page eyebrow="Docs" title="Official APIs">
      <p>
        Autonomo runs its own APIs for {TOKEN.chainName}, each behind a gateway and payable per call in USDG or{" "}
        {TOKEN.symbol}. Call them at <code>{HOST}/x/&lt;slug&gt;&lt;path&gt;</code>. They are grouped by what you are
        asking about: a token, a wallet or a transaction. Those three groups read {TOKEN.chainName} directly.
      </p>
      {shelve(OFFICIAL_APIS).map(({ shelf, apis }) => (
        <div key={shelf.id}>
          <h3 className="mt-6 flex flex-wrap items-center gap-2 font-medium text-ink">
            {shelf.title}
            {shelf.onchain && (
              <span className="rounded-full border border-accent px-2 py-0.5 text-[11px] font-normal text-accent">
                On-chain
              </span>
            )}
            <span className="text-sm font-normal text-faint">{shelf.about}</span>
          </h3>
          <Table
            rows={apis.map((a) => [
              <>
                <span className="font-medium whitespace-nowrap text-ink">{a.name}</span>
                <span className="block font-mono text-xs whitespace-nowrap text-faint">
                  /x/{a.slug}
                  {a.path}
                </span>
              </>,
              a.about,
            ])}
          />
        </div>
      ))}
      <p>
        Try any of them without a wallet in the <Link href="/playground">Agent Playground</Link>, or call them from your
        agent: see <Link href="/docs/agents">Use Autonomo from your agent</Link>. They also accept private payments from a
        Gloam balance: see <Link href="/docs/gloam">Pay privately with Gloam</Link>.
      </p>

      <Section id="official-wallets" title="The wallets behind them">
        <p>
          Until Nov 3, 2026, one wallet signed in, got paid and held the {TOKEN.symbol} for Verified. Those jobs are now
          split across three wallets:
        </p>
        <Table
          rows={OFFICIAL_WALLETS.map((w) => [
            <>
              <span className="font-medium whitespace-nowrap text-ink">{w.job}</span>
              <a href={`${TOKEN.explorer}/address/${w.address}`} className="block font-mono text-xs break-all">
                {w.address}
              </a>
            </>,
            w.about,
          ])}
        />
        <p>
          Moving anything out of the Safe takes both signatures, but it isn&apos;t a time-lock: both signers are ours, so the
          tokens can still move if both approve. You can read the signers and threshold on Blockscout. The tokens moved to
          the Safe in{" "}
          <a href={`${TOKEN.explorer}/tx/0x3572d00c16b869fbeec6d267e08108b2d5decdb93d90532114f66390d6099f65`}>this transaction</a>,
          and here&apos;s the{" "}
          <a href={`${TOKEN.explorer}/tx/0xfd8a1c8c76410ec259ae171fe21a4438657ae579642c4ec2cd38966565dc574e`}>first paid call</a>{" "}
          into it. Your APIs can get paid at a Safe too: see <Link href="/docs/safe">Get paid at a Safe</Link>.
        </p>
      </Section>

      <Section id="first-outside-payer" title="The first outside payment">
        <figure className="rounded-xl border-4 border-double border-accent p-1.5">
          <div className="rounded-lg border border-line bg-surface p-5 text-center">
            <p className="font-mono text-xs tracking-wide text-accent uppercase">Nov 3, 2026 · Risk Checker</p>
            <p className="heading mt-3 text-4xl text-ink">0.01 USDG</p>
            <p className="mt-3 text-muted">
              Paid by <a href="https://x.com/Agent_Minimum">Minimum Viable Agent</a>, an AI agent built by{" "}
              <a href="https://x.com/un_known_lab">@un_known_lab</a>, with its own wallet and its own x402 client. It asked
              about {TOKEN.symbol} and got back: risk 0, low.
            </p>
            <p className="mt-3 font-mono text-xs break-all">
              <a href={`${TOKEN.explorer}/tx/${FIRST_OUTSIDE_PAYMENT}`}>{FIRST_OUTSIDE_PAYMENT}</a>
            </p>
          </div>
        </figure>
        <p>Every paid call before it came from our own wallets. This one is on the wall for good.</p>
      </Section>
    </Page>
  );
}
