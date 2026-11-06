import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { Page, Section, Table } from "../ui";

export const metadata: Metadata = {
  title: "Official APIs",
  description: `The APIs Autonomo runs for ${TOKEN.chainName}: token prices, new launches, rug-risk checks, transactions, wallets and web pages, payable per call in USDG or ${TOKEN.symbol}.`,
};

const HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// The APIs Autonomo runs itself (official-apis/tools). Each sits behind its own gateway at /x/<slug>.
const OFFICIAL_APIS: { name: string; slug: string; path: string; about: string }[] = [
  { name: "Token Price", slug: "token-price", path: "/price/autonomo", about: `The live ${TOKEN.symbol} price` },
  { name: "Token Lookup", slug: "token-lookup", path: "/price/<token>", about: "Price and market cap of any Robinhood Chain launchpad token, from its bonding curve or, after graduation, its Uniswap v4 pool" },
  { name: "New Launches", slug: "new-launches", path: "/launches?limit=10", about: "The newest launchpad tokens: age, buys, sells, market cap and curve progress" },
  { name: "Risk Checker", slug: "token-risk", path: "/risk/<token>", about: "A rug-risk score from holder concentration, the creator, launch-block buyers and bot volume" },
  { name: "Tx Explainer", slug: "tx-explainer", path: "/tx/<hash>", about: "A Robinhood Chain transaction in plain English: launches, buys, sells, transfers and fee" },
  { name: "Wallet Portfolio", slug: "wallet-portfolio", path: "/portfolio/<wallet>", about: "ETH, USDG, WETH, $AUTONOMO and recently received tokens, valued in USD, with impostor tokens flagged" },
  { name: "Page Reader", slug: "page-reader", path: "/page?url=<https link>", about: "Title, description and readable text of a public web page" },
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
        {TOKEN.symbol}. Call them at <code>{HOST}/x/&lt;slug&gt;&lt;path&gt;</code>. Everything is read from public
        chains.
      </p>
      <Table
        rows={OFFICIAL_APIS.map((a) => [
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
