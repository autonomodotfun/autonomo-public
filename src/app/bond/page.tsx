import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BondedBadge, fmtBond, SlashList } from "@/components/bonded";
import { bondContract, bondEnabled, bondRefundWallet, bondUsd, getBondRequirement, getBondSettings, slashesOrNull } from "@/lib/trust/bond";
import { BURN_DEAD } from "@/lib/payments/burn";
import { TOKEN } from "@/lib/constants";
import { getGatewayBonds } from "@/lib/directory/queries";

export const metadata: Metadata = {
  title: "Provider bond",
  description: `API creators lock ${TOKEN.symbol} as a bond. If a bonded API takes payments and doesn't deliver, part of the bond refunds the payer and the rest is burned. Every slash is listed here with its evidence.`,
};

const days = (seconds: number) => {
  const d = Math.round(seconds / 86400);
  return `${d} day${d === 1 ? "" : "s"}`;
};

export default async function BondPage() {
  if (!bondEnabled()) notFound();
  const contract = bondContract()!;
  const [settings, bonds, slashes, requirement] = await Promise.all([getBondSettings(), getGatewayBonds(), slashesOrNull(), getBondRequirement()]);
  if (!settings) notFound();
  const now = Math.floor(Date.now() / 1000);
  const refundWallet = bondRefundWallet();
  const bonded = Object.entries(bonds.byProject).filter(([, b]) => b.bonded);
  const maxSlash = settings.maxSlashBps / 100;
  const refund = settings.refundBps / 100;
  const addresses = [
    { label: "Bond contract", address: contract },
    { label: "Owner (cancels slashes, replaces the slasher, changes the settings)", address: settings.owner },
    { label: "Slasher (opens slashes)", address: settings.slasher },
    { label: "Refund wallet (passes refunds on when several payers lost money)", address: refundWallet },
    { label: "Dead address (where the burned share goes)", address: BURN_DEAD },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">Something to lose</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">Provider bond</h1>
      <p className="mt-4 text-muted">
        An API creator can lock {TOKEN.symbol} as a bond, and their APIs show as <BondedBadge />. If a bonded API takes
        payments and doesn&apos;t deliver, part of the bond is slashed: {refund}% of the slash refunds the payer and the rest is
        burned. Verified shows a creator holds the token. Bonded shows they have something to lose.
      </p>
      <p className="mt-4 rounded-md border border-warn px-4 py-3 text-sm text-warn">
        The bond contract has not been audited. Its source is public and tested, but a creator who bonds today takes the risk
        of a bug nobody has found yet.
      </p>

      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        <Stat label="Locked in bonds" value={`${fmtBond(settings.totalBonded)} ${TOKEN.symbol}`} note="Read from the contract" />
        <Stat
          label="Amount to show as Bonded"
          value={requirement ? `${requirement.tokens.toLocaleString("en-US")} ${TOKEN.symbol}` : "—"}
          note={requirement ? `About $${requirement.usd.toLocaleString("en-US")} at last week's average, set weekly` : "This week's amount couldn't be read just now"}
        />
        <Stat label="Bonded APIs" value={String(bonded.length)} note="Listed on Autonomo" />
      </div>

      <h2 className="heading mt-12 text-2xl">For a creator</h2>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted">
        <li>
          Lock about ${bondUsd().toLocaleString("en-US")} of {TOKEN.symbol} or more from the wallet your APIs pay. It&apos;s one
          bond per wallet, for all of that wallet&apos;s APIs. The steps are on your{" "}
          <Link href="/dashboard#bond" className="underline hover:text-ink">dashboard</Link>.
        </li>
        <li>
          The amount in tokens is set once a week from the previous week&apos;s average price, like Verified. Once your APIs
          show as Bonded, your amount is locked: it won&apos;t go up if the price falls, and it moves down if the weekly amount
          falls below it. Take tokens out below your amount and you qualify again at the current weekly amount.
        </li>
        <li>To leave, ask to withdraw. That amount stops counting at once, and you can take it out {days(settings.cooldownS)} later.</li>
        <li>You can drop the request at any time to stay bonded.</li>
      </ol>

      <h2 className="heading mt-12 text-2xl">What gets a bond slashed</h2>
      <p className="mt-4 text-muted">
        A gateway only charges an agent when the API answers. A call that errors or times out is never charged, so an outage
        is not a reason for a slash. A slash is for calls that were charged and came back empty, wrong, or not what the API
        says it returns.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted">
        <li>
          Autonomo&apos;s slasher opens a slash, naming the wallet, the amount and who gets the refund. The slash carries the hash
          of its evidence: the charged calls and their payment transactions. The evidence is published in the list below.
        </li>
        <li>
          The slash waits {days(settings.disputeWindowS)}. In that time the creator can dispute it on{" "}
          <a href="https://t.me/autonomodotfun" className="underline hover:text-ink">Telegram</a>, and the owner can cancel it.
        </li>
        <li>
          After that anyone can run it. {refund}% goes to the payer and the rest to the dead address. A slash nobody runs
          within 7 days expires.
        </li>
        <li>The API loses its Bonded badge for 30 days, and its slash history stays on its page.</li>
      </ol>
      <p className="mt-4 text-muted">
        When several agents lost money, the slash names Autonomo&apos;s refund wallet as the payer. That wallet passes the
        refund on to each agent in proportion to what they lost, and the transfers are listed with the slash. It keeps none
        of it. Refunds are paid in {TOKEN.symbol}, whatever the agent paid with.
      </p>

      <h2 className="heading mt-12 text-2xl">Limits nobody can lift</h2>
      <p className="mt-4 text-muted">These are written into the contract. The owner can&apos;t change them.</p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-muted">
        <li>One slash takes at most {maxSlash}% of a bond today, and that setting can never go above 50%.</li>
        <li>At least half of every slash is burned, so slashing can never mostly pay whoever decides it.</li>
        <li>
          A creator can be slashed once every 30 days at most. The wait to withdraw is never longer than 21 days, so after one
          slash a creator can always take the rest out before a second one.
        </li>
        <li>A withdrawal that has finished its wait can&apos;t be reduced or blocked by a new slash.</li>
        <li>Bonded tokens leave only through the creator&apos;s own withdrawal or a slash. There is no other way out.</li>
      </ul>

      <h2 className="heading mt-12 text-2xl">Who decides</h2>
      <p className="mt-4 text-muted">
        A person decides a slash, not code: the contract can&apos;t see whether an API answered well. Today that is Autonomo,
        from the gateway&apos;s logs. The owner can replace the slasher and change the settings inside the limits above, so the
        owner is who creators trust. The worst an honest creator can lose to a wrong slash is one slash of {maxSlash}%, and
        then they can leave.
      </p>

      <h2 className="heading mt-12 text-2xl">Bonded APIs</h2>
      {bonded.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-3 text-muted">No listed API is bonded yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
          {bonded.map(([slug, b]) => (
            <li key={slug} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <Link href={`/projects/${slug}`} className="underline hover:text-ink">
                {slug}
              </Link>
              <span className="font-mono text-muted">
                {fmtBond(b.active)} {TOKEN.symbol}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 id="slashes" className="heading mt-12 scroll-mt-6 text-2xl">
        Slashes
      </h2>
      {slashes === null ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-3 text-muted">
          The list couldn&apos;t be read from the chain just now. Every slash is also an event on the contract.
        </p>
      ) : slashes.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-3 text-muted">No slash has been opened.</p>
      ) : (
        <div className="mt-4">
          <SlashList slashes={slashes} now={now} refundWallet={refundWallet} />
        </div>
      )}

      <h2 className="heading mt-12 text-2xl">Contract and wallets</h2>
      <ul className="mt-4 grid gap-3 text-sm">
        {addresses
          .filter((a): a is { label: string; address: string } => !!a.address)
          .map((a) => (
            <li key={a.label}>
              <span className="text-muted">{a.label}</span>
              <br />
              <a href={`${TOKEN.explorer}/address/${a.address}`} target="_blank" rel="noreferrer" className="font-mono text-xs break-all underline hover:text-ink">
                {a.address}
              </a>
            </li>
          ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Source and tests:{" "}
        <a href="https://github.com/autonomodotfun/autonomo-public/tree/main/contracts/robinhood" className="underline hover:text-ink">
          contracts/robinhood
        </a>
        . Settings today: wait to withdraw {days(settings.cooldownS)}, dispute window {days(settings.disputeWindowS)}, at most{" "}
        {maxSlash}% per slash, {refund}% of a slash refunded. The contract&apos;s own minimum, a floor under the weekly amount,
        is {fmtBond(settings.minBond)} {TOKEN.symbol}.
      </p>
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
