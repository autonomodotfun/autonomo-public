import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TOKEN } from "@/lib/constants";
import { REWARDS_REPORTS } from "@/data/rewards-reports";
import { REWARDS } from "@/lib/rewards/rewards-rules";
import { REWARDS_SAFE, REWARDS_VESTING, minimumsOrNull, rewardsEnabled, vestingOrNull } from "@/lib/rewards/rewards";
import { WalletCheck } from "./wallet-check";

export const metadata: Metadata = {
  title: "Rewards",
  description: `Each month Autonomo hands out ${TOKEN.symbol} to the people who make it useful: API creators, integrators who bring paid calls with a ref code, and agents that hold the Agent Pass. The rules, the vesting contract and every month's payouts are here.`,
};

const whole = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

export default async function RewardsPage() {
  if (!rewardsEnabled()) notFound();
  const [vesting, mins] = await Promise.all([vestingOrNull(), minimumsOrNull()]);
  const now = Math.floor(Date.now() / 1000);
  const setAside = vesting ? Number(vesting.held) + Number(vesting.released) : null;
  const started = vesting ? now >= vesting.start : false;
  const { split } = REWARDS;
  const firstPayout = dayOf(REWARDS.firstPayout);
  const countingStarts = dayOf(REWARDS.countingStarts);
  const passLine = mins ? `${whole(mins.passTokens)} ${TOKEN.symbol} this week` : "this week's amount couldn't be read just now";
  const integratorLine = mins ? `${whole(mins.integratorTokens)} ${TOKEN.symbol} this week` : "this week's amount couldn't be read just now";

  return (
    <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">Paid for real usage</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">Rewards</h1>
      <p className="mt-4 text-muted">
        Each month Autonomo hands out {TOKEN.symbol} to the people who make it useful: creators whose APIs agents pay for,
        integrators who bring paid calls, and agents that hold the Agent Pass. The tokens come from a vesting contract that
        releases 1% of the supply over 180 days, plus a share of what Autonomo&apos;s own APIs earn. Calls count from{" "}
        {countingStarts}, and the first payout is on {firstPayout}.
      </p>

      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        <Stat
          label="Set aside for rewards"
          value={setAside === null ? "—" : `${whole(setAside)} ${TOKEN.symbol}`}
          note={setAside === null ? "The vesting contract couldn't be read just now" : "Read from the vesting contract"}
        />
        <Stat
          label="Released so far"
          value={vesting ? `${whole(Number(vesting.released))} ${TOKEN.symbol}` : "—"}
          note={vesting ? (started ? `Released evenly until ${day(vesting.end)}` : `Starts on ${day(vesting.start)}, then evenly until ${day(vesting.end)}`) : ""}
        />
        <Stat label="Next payout" value={REWARDS_REPORTS.length ? "The 1st of next month" : firstPayout} note="Once a month, for the month before" />
      </div>

      <h2 className="heading mt-12 text-2xl">Who earns</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card
          eyebrow="API creators"
          title={`Up to ${pct(REWARDS.creatorRate)} of what outside agents paid you`}
          points={[
            "Your API is launched through Autonomo, so its payments pass through a gateway. Directory-only APIs don't count.",
            `At least ${REWARDS.creatorMinPayers} different outside wallets paid it that month, for ${REWARDS.creatorMinCalls} calls or more.`,
            "Calls from your own wallets, and from wallets linked to them, are left out.",
          ]}
          action={{ href: "/dashboard", label: "Launch an API" }}
        />
        <Card
          eyebrow="Integrators"
          title={`Up to ${pct(REWARDS.integratorRateOfficial)} of the calls you bring`}
          points={[
            `${pct(REWARDS.integratorRateOfficial)} of what your calls paid Autonomo's own APIs, and ${pct(REWARDS.integratorRateExternal)} of what they paid creators' APIs.`,
            `Register a ref code and send it with each call. Calls from at least ${REWARDS.integratorMinPayers} wallets that aren't yours.`,
            `Hold about $${mins?.integratorUsd ?? REWARDS.integratorUsd} of ${TOKEN.symbol} at the end of the month: ${integratorLine}.`,
          ]}
          action={{ href: "/dashboard#ref-code", label: "Get a ref code" }}
        />
        <Card
          eyebrow="Agents"
          title={`${pct(REWARDS.cashbackRate)} cashback on Autonomo's own APIs`}
          points={[
            `Hold the Agent Pass: about $${mins?.passUsd ?? REWARDS.passUsd} of ${TOKEN.symbol} in the wallet that pays, ${passLine}.`,
            "The wallet holds it when it pays, and still holds it at the end of the month.",
            "Nothing to buy from us and nothing to deposit. The tokens stay in your wallet.",
          ]}
          action={{ href: "/docs/official-apis", label: "See the APIs" }}
        />
      </div>
      <p className="mt-4 text-sm text-muted">
        &ldquo;Up to&rdquo;, because each pool has a ceiling: nobody takes more than {pct(REWARDS.poolCapShare)} of a pool
        ({pct(REWARDS.cashbackWalletCapShare)} per wallet for cashback), and when a pool is too small for the month, everyone
        in it is scaled down by the same share.
      </p>

      <h2 className="heading mt-12 text-2xl">The monthly split</h2>
      <p className="mt-4 text-muted">
        What came in during the month, from the vesting contract and from Autonomo&apos;s own APIs, is split four ways.
      </p>
      <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Stat label="Creators" value={`${split.creators}%`} note="For APIs outside agents pay" />
        <Stat label="Integrators" value={`${split.integrators}%`} note="For calls brought with a ref code" />
        <Stat label="Cashback" value={`${split.cashback}%`} note="For agents with the Agent Pass" />
        <Stat label="Burned" value={`${split.burn}%`} note="Sent to the dead address" />
      </div>

      <h2 className="heading mt-12 text-2xl">The one rule behind the numbers</h2>
      <p className="mt-4 text-muted">
        A reward on a call is always smaller than what that call cost for good. A call to a creator&apos;s API costs the 5%
        burn for good, so creator and integrator rewards together stay under 5%. A call to one of Autonomo&apos;s own APIs
        costs all of it, so cashback and integrator rewards together stay well under the price. Paying your own calls to
        collect rewards therefore always loses money, however many wallets you use.
      </p>

      <h2 id="ref-codes" className="heading mt-12 scroll-mt-6 text-2xl">
        Ref codes
      </h2>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted">
        <li>
          Sign in and register a code on your <Link href="/dashboard#ref-code" className="underline hover:text-ink">dashboard</Link>:
          3 to 20 letters or digits, one per wallet. The wallet you sign in with is the one that gets paid.
        </li>
        <li>
          Send it with every paid call your agents, framework or bot make, as a header: <code>X-Autonomo-Ref: YOURCODE</code>.
        </li>
        <li>
          Each call that settles with your code is noted. A code nobody registered is ignored, and the call works as
          usual.
        </li>
      </ol>
      <p className="mt-4 text-sm text-muted">
        The header works on every gateway address today. A <code>ref</code> option in the SDK, the CLI and the MCP server
        is next.
      </p>

      <h2 id="check" className="heading mt-12 scroll-mt-6 text-2xl">
        Check a wallet
      </h2>
      <p className="mt-4 text-muted">
        What a wallet holds against the two minimums, its ref code, and what is counted for it this month. Everything
        shown is public on the chain already.
      </p>
      <WalletCheck symbol={TOKEN.symbol} minPayers={REWARDS.integratorMinPayers} minCalls={REWARDS.creatorMinCalls} />

      <h2 className="heading mt-12 text-2xl">What isn&apos;t handed out</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-muted">
        <li>
          A payout under {whole(REWARDS.minPayoutTokens)} {TOKEN.symbol} is not sent. It stays in its pool for the next
          month.
        </li>
        <li>What a pool doesn&apos;t hand out is carried over to the next month.</li>
        <li>
          When the pools carry more than {whole(REWARDS.carryCapTokens)} {TOKEN.symbol} between them, the part above that is
          burned.
        </li>
      </ul>

      <h2 className="heading mt-12 text-2xl">Every month</h2>
      {REWARDS_REPORTS.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-3 text-muted">
          No month has been paid yet. The first run is on {firstPayout}, for the calls of December 2026. Its report and its
          list of payouts will be published here, so anyone can check them against the chain.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
          {REWARDS_REPORTS.map((r) => (
            <li key={r.month} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
              <span className="font-medium">{r.month}</span>
              <span className="text-muted">
                {whole(r.paid)} paid · {whole(r.burned)} burned · {whole(r.carriedOver)} carried over
              </span>
              <span className="flex gap-4">
                <a href={r.report} className="underline hover:text-ink">Report</a>
                <a href={r.payouts} className="underline hover:text-ink">Payouts</a>
                <a href={`${TOKEN.explorer}/tx/${r.tx}`} className="underline hover:text-ink">Transaction</a>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="heading mt-12 text-2xl">Good to know</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-muted">
        <li>
          <span className="text-ink">The first months will pay little.</span> Rewards follow real paid calls, and there
          aren&apos;t many yet. While usage is low, most of each month is carried over, then burned above the limit.
        </li>
        <li>
          <span className="text-ink">Holding the token alone earns nothing.</span> Rewards are a bonus on paid usage: an API
          agents pay for, calls you bring, or calls you pay for.
        </li>
        <li>
          <span className="text-ink">Which calls count.</span> A call counts when its payment settled through an Autonomo
          gateway, in USDG or {TOKEN.symbol} on {TOKEN.chainName}. Calls paid in USDC on Base are recorded too; whether they
          count is not decided yet. A private Gloam payment can count for a ref code, but not for cashback, because the
          payer can&apos;t be seen.
        </li>
        <li>
          <span className="text-ink">Where the record comes from.</span> Ref codes and the Agent Pass check are noted by the
          gateway at each paid call, not written on the chain. That is why each month&apos;s files are published.
        </li>
        <li>
          <span className="text-ink">Who sends the payouts.</span> The Rewards Safe, a multisig that needs two signatures. The
          vesting contract releases only to its owner, and its owner is that Safe.
        </li>
      </ul>

      <h2 className="heading mt-12 text-2xl">Contract and wallet</h2>
      <dl className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
        {[
          { label: "Vesting contract (holds the tokens and releases them over 180 days)", address: REWARDS_VESTING },
          { label: "Rewards Safe (receives what is released and sends the payouts)", address: REWARDS_SAFE },
        ].map((a) => (
          <div key={a.address} className="px-4 py-3">
            <dt className="text-muted">{a.label}</dt>
            <dd className="mt-1 font-mono text-xs break-all">
              <a href={`${TOKEN.explorer}/address/${a.address}`} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                {a.address}
              </a>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-bg p-4">
      <p className="text-xs text-faint">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function Card({ eyebrow, title, points, action }: { eyebrow: string; title: string; points: string[]; action: { href: string; label: string } }) {
  return (
    <section className="flex flex-col rounded-lg border border-line p-5">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">{eyebrow}</p>
      <h3 className="heading mt-2 text-xl">{title}</h3>
      <ul className="mt-3 flex-1 list-disc space-y-1.5 pl-5 text-sm text-muted">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <Link href={action.href} className="mt-4 text-sm underline hover:text-ink">
        {action.label}
      </Link>
    </section>
  );
}
