import Link from "next/link";
import { BondedBadge, fmtBond, fmtDay } from "@/components/bonded";
import { bondUsd, walletBondOrNull } from "@/lib/trust/bond";
import { shortOfMinimum } from "@/lib/trust/bond-rules";
import { TOKEN } from "@/lib/constants";
import { privyEnabled } from "@/lib/auth/privy";
import { isContractWallet } from "@/lib/trust/verified";
import { BondStepsBrowser, BondStepsManual, BondStepsPrivy, type BondStepsProps } from "./bond-steps";

/**
 * On the dashboard: the bond of the wallet the owner's APIs pay, and how to lock it or take it out. The bond is read
 * on the paid wallet, like Verified, so a Safe bonds from the Safe.
 */
export async function BondPanel({ owner, payee }: { owner: string; payee: string }) {
  const read = await walletBondOrNull(payee);
  if (!read) return null;
  const { contract, settings, bond, heldBySlash } = read;
  const required = BigInt(bond.required) * 10n ** 18n;
  const state = {
    amount: BigInt(bond.amount),
    pendingWithdraw: BigInt(bond.pendingWithdraw),
    withdrawReadyAt: bond.withdrawReadyAt,
    nextSlashAt: bond.hiddenUntil ?? 0,
    openSlashId: BigInt(bond.openSlashId),
  };
  const short = shortOfMinimum(state, required);
  const contractWallet = payee !== owner ? await isContractWallet(payee) : false;

  const steps: BondStepsProps = {
    bond: contract,
    payee,
    amount: bond.amount,
    pendingWithdraw: bond.pendingWithdraw,
    withdrawReadyAt: bond.withdrawReadyAt,
    short: short.toString(),
    cooldownDays: Math.round(settings.cooldownS / 86400),
    heldBySlash,
  };

  return (
    <section id="bond" className="mt-10 scroll-mt-6 rounded-lg border border-line p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading text-xl">Provider bond</h2>
        <Link href="/bond" className="text-muted underline hover:text-ink">
          How the bond works
        </Link>
      </div>
      <p className="mt-1 text-muted">
        Lock {TOKEN.symbol} from the wallet your APIs pay and they show as <BondedBadge />. If one of them takes payments and
        doesn&apos;t deliver, up to {settings.maxSlashBps / 100}% of the bond can be slashed. You get the rest back{" "}
        {steps.cooldownDays} days after asking.
      </p>

      <dl className="mt-4 grid gap-2 sm:grid-cols-3">
        <Fact label="Locked" value={`${fmtBond(bond.amount)} ${TOKEN.symbol}`} />
        <Fact label="Amount to show as Bonded" value={`${bond.required.toLocaleString("en-US")} ${TOKEN.symbol}`} />
        <Fact
          label="Status"
          value={
            bond.hiddenUntil !== null
              ? `Slashed. Badge hidden until ${fmtDay(bond.hiddenUntil)}`
              : bond.bonded
                ? "Bonded"
                : state.amount === 0n
                  ? "Not bonded"
                  : `Not bonded: ${fmtBond(short.toString())} short`
          }
        />
      </dl>
      <p className="mt-2 text-muted">
        {bond.locked
          ? `Your amount is locked at ${bond.required.toLocaleString("en-US")} ${TOKEN.symbol}: it won't go up if the price falls, and it moves down if the weekly amount falls below it.`
          : `That's about $${bondUsd().toLocaleString("en-US")} at last week's average price, set once a week. Once your APIs show as Bonded, your amount is locked and won't go up.`}
      </p>
      {bond.openSlashId > 0 && (
        <p className="mt-3 text-warn">
          Slash {bond.openSlashId} is open against this bond. See it on{" "}
          <Link href="/bond#slashes" className="underline">
            the slash list
          </Link>
          , and write to us on{" "}
          <a href="https://t.me/autonomodotfun" className="underline">
            Telegram
          </a>{" "}
          to dispute it before its window ends.
        </p>
      )}
      <p className="mt-3 font-mono text-xs break-all text-faint">
        Bonding wallet {payee} · contract{" "}
        <a href={`${TOKEN.explorer}/address/${contract}`} target="_blank" rel="noreferrer" className="underline hover:text-ink">
          {contract}
        </a>
      </p>

      {payee !== owner ? (
        <BondStepsManual {...steps} safe={contractWallet !== false} />
      ) : privyEnabled() ? (
        <BondStepsPrivy {...steps} />
      ) : (
        <BondStepsBrowser {...steps} />
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
