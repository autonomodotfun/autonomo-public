import Link from "next/link";
import type { SlashRecord, WalletBond } from "@/lib/bond";
import { openSlashStatus } from "@/lib/bond-rules";
import { TOKEN } from "@/lib/constants";
import { fmtAutonomo, shortAddr } from "@/lib/gateway-format";

// What the public sees of the provider bond: the badge, an API's bond, and the list of slashes.

/** Whole tokens with thousands separators, without the symbol. */
export const fmtBond = (atomic: string | null | undefined) => fmtAutonomo(atomic).replace(" AUTONOMO", "");

export function fmtDay(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function BondedBadge() {
  return (
    <span
      title={`The wallet behind this API has locked ${TOKEN.symbol} as a bond. Part of it can be taken if the API takes payments and doesn't deliver. This isn't a review of the API.`}
      className="shrink-0 rounded border border-accent px-1.5 py-px text-[11px] font-medium text-accent"
    >
      ◆ Bonded
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  waiting: "In its dispute window",
  ready: "Can run now",
  expired: "Expired, not run",
  executed: "Ran",
  cancelled: "Cancelled",
};

/** The slashes given, newest first, each with its evidence and on-chain receipts. */
export function SlashList({ slashes, now, refundWallet }: { slashes: SlashRecord[]; now: number; refundWallet?: string | null }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
      {slashes.map((s) => {
        const status = s.state === "open" ? openSlashStatus(s.executableAt, now) : s.state;
        const viaRefundWallet = !!s.payer && !!refundWallet && s.payer === refundWallet.toLowerCase();
        return (
          <li key={s.id} className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-medium">
                Slash {s.id}: {fmtBond(s.amount)} {TOKEN.symbol} from{" "}
                <a href={`${TOKEN.explorer}/address/${s.provider}`} target="_blank" rel="noreferrer" className="font-mono text-xs underline hover:text-ink">
                  {shortAddr(s.provider)}
                </a>
              </p>
              <p className={status === "executed" ? "text-warn" : "text-muted"}>
                {STATUS_LABEL[status]}
                {status === "waiting" && ` until ${fmtDay(s.executableAt)}`}
                {s.closedAt !== null && ` on ${fmtDay(s.closedAt)}`}
              </p>
            </div>
            <p className="mt-1 text-muted">
              {s.evidence?.summary ?? "Evidence not published yet."}{" "}
              {s.evidence?.url && (
                <a href={s.evidence.url} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                  Read the evidence
                </a>
              )}
            </p>
            {s.state === "open" && (
              <p className="mt-1 text-muted">
                {s.payer ? (
                  <>
                    If it runs, the refund share goes to{" "}
                    <a href={`${TOKEN.explorer}/address/${s.payer}`} target="_blank" rel="noreferrer" className="font-mono text-xs underline hover:text-ink">
                      {shortAddr(s.payer)}
                    </a>
                    {viaRefundWallet && " (Autonomo's refund wallet, which passes it on to each payer)"} and the rest is burned.
                  </>
                ) : (
                  "If it runs, all of it is burned."
                )}
              </p>
            )}
            {s.state === "executed" && (
              <p className="mt-1 text-muted">
                {fmtBond(s.refunded)} refunded
                {s.payer ? (
                  <>
                    {" "}
                    to{" "}
                    <a href={`${TOKEN.explorer}/address/${s.payer}`} target="_blank" rel="noreferrer" className="font-mono text-xs underline hover:text-ink">
                      {shortAddr(s.payer)}
                    </a>
                    {viaRefundWallet && " (Autonomo's refund wallet, which passes it on to each payer)"}
                  </>
                ) : null}
                , {fmtBond(s.burned)} burned.
              </p>
            )}
            {s.evidence?.refunds && s.evidence.refunds.length > 0 && (
              <p className="mt-1 text-muted">
                Passed on to payers:{" "}
                {s.evidence.refunds.map((tx, i) => (
                  <a key={tx} href={`${TOKEN.explorer}/tx/${tx}`} target="_blank" rel="noreferrer" className="mr-2 underline hover:text-ink">
                    transfer {i + 1}
                  </a>
                ))}
              </p>
            )}
            <p className="mt-2 font-mono text-xs break-all text-faint">
              Evidence hash {s.reason} ·{" "}
              <a href={`${TOKEN.explorer}/tx/${s.proposedTx}`} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                opened
              </a>
              {s.closedTx && (
                <>
                  {" "}
                  ·{" "}
                  <a href={`${TOKEN.explorer}/tx/${s.closedTx}`} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                    {s.state === "executed" ? "ran" : "cancelled"}
                  </a>
                </>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** On an API's page: its bond, whether a slash hid the badge, and its slash history. */
export function BondBlock({ bond, slashes, now, refundWallet }: { bond: WalletBond; slashes: SlashRecord[] | null; now: number; refundWallet?: string | null }) {
  const mine = slashes?.filter((s) => s.provider === bond.wallet) ?? [];
  return (
    <section className="mt-10 rounded-lg border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading text-xl">Provider bond</h2>
        <Link href="/bond" className="text-sm text-muted underline hover:text-ink">
          How the bond works
        </Link>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        {BigInt(bond.active) > 0n ? (
          <>
            The wallet this API pays has <span className="font-mono text-ink">{fmtBond(bond.active)}</span> {TOKEN.symbol} locked as a
            bond. Part of it can be taken if the API takes payments and doesn&apos;t deliver.
          </>
        ) : (
          <>The wallet this API pays has no {TOKEN.symbol} locked as a bond right now.</>
        )}{" "}
        {BigInt(bond.pendingWithdraw) > 0n && (
          <>
            The creator has asked to take out {fmtBond(bond.pendingWithdraw)}, which no longer counts and can leave from{" "}
            {fmtDay(bond.withdrawReadyAt)}.{" "}
          </>
        )}
        {bond.hiddenUntil !== null && (
          <span className="text-warn">This bond was slashed, so the Bonded badge is hidden until {fmtDay(bond.hiddenUntil)}.</span>
        )}
      </p>
      {slashes === null ? (
        <p className="mt-3 text-sm text-muted">The slash history couldn&apos;t be read just now.</p>
      ) : (
        mine.length > 0 && (
          <div className="mt-4">
            <SlashList slashes={mine} now={now} refundWallet={refundWallet} />
          </div>
        )
      )}
    </section>
  );
}
