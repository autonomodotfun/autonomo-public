import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { REWARDS } from "@/lib/rewards/rewards-rules";
import { walletRewards } from "@/lib/rewards/rewards";
import { registerRefCodeAction } from "./actions";

const whole = (n: number) => n.toLocaleString("en-US");

/**
 * On the dashboard: the signed-in wallet's ref code for the monthly rewards. A wallet registers one code, sends it
 * with the paid calls it brings, and is paid for them at the end of the month. Shown to every signed-in wallet,
 * whether or not it has launched an API: an integrator usually hasn't.
 */
export async function RefCodePanel({ owner, draft, note }: { owner: string; draft?: string; note?: string }) {
  const mine = await walletRewards(owner).catch((e) => (console.error("ref code panel failed", e), null));
  const mins = mine?.minimums ?? null;
  const brought = mine?.counts.brought ?? null;

  return (
    <section id="ref-code" className="mt-10 scroll-mt-6 rounded-lg border border-line p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading text-xl">Your ref code</h2>
        <Link href="/rewards" className="text-muted underline hover:text-ink">
          How rewards work
        </Link>
      </div>
      <p className="mt-1 text-muted">
        Bring paid calls to Autonomo and earn {TOKEN.symbol} for them each month: up to {REWARDS.integratorRateOfficial * 100}% of
        what those calls paid Autonomo&apos;s own APIs, and up to {REWARDS.integratorRateExternal * 100}% of what they paid
        creators&apos; APIs.
      </p>

      {note && (
        <p role="status" className="mt-4 rounded-md border border-line bg-surface p-3">
          {note}
        </p>
      )}

      {mine === null ? (
        <p className="mt-4 rounded-md border border-dashed border-line p-3 text-muted">Your ref code couldn&apos;t be read just now. Reload in a moment.</p>
      ) : mine.refCode ? (
        <>
          <dl className="mt-4 grid gap-2 sm:grid-cols-3">
            <Fact label="Your code" value={mine.refCode} />
            <Fact label="Calls brought this month" value={mine.window.started ? whole(brought?.calls ?? 0) : "—"} />
            <Fact label="Different payers" value={mine.window.started ? whole(brought?.payers ?? 0) : "—"} />
          </dl>
          <p className="mt-4 text-muted">Send it with every paid call, as a header:</p>
          <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-xs">X-Autonomo-Ref: {mine.refCode}</pre>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-muted">
            <li>
              To be paid for a month you need calls from at least {REWARDS.integratorMinPayers} different wallets that aren&apos;t
              yours, and to hold about ${mins?.integratorUsd ?? REWARDS.integratorUsd} of {TOKEN.symbol}
              {mins ? ` (${whole(mins.integratorTokens)} this week)` : ""} in this wallet at the end of the month.
            </li>
            <li>
              {mine.holds === null || mins === null
                ? "Your balance couldn't be read just now."
                : mine.meetsIntegratorMinimum
                  ? `This wallet holds ${whole(mine.holds)} ${TOKEN.symbol}: enough today.`
                  : `This wallet holds ${whole(mine.holds)} ${TOKEN.symbol}: ${whole(mins.integratorTokens - mine.holds)} short today.`}
            </li>
            {!mine.window.started && <li>Calls count from December 1, 2026. The first payout is on January 1, 2027.</li>}
            <li>A code can&apos;t be changed: the calls made with it are on the record under that name.</li>
          </ul>
        </>
      ) : (
        <form action={registerRefCodeAction} className="mt-4 grid gap-2 sm:max-w-xl">
          <label htmlFor="refCode" className="font-medium">
            Pick a code
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="refCode"
              name="code"
              required
              defaultValue={draft}
              placeholder="MYAGENT"
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9]{3,20}"
              spellCheck={false}
              autoComplete="off"
              className="field min-w-0 flex-1 font-mono uppercase"
            />
            <button className="btn-brand px-3 py-2">Register</button>
          </div>
          <p className="text-xs text-faint">
            3 to 20 letters or digits. One code per wallet, and it can&apos;t be changed later. Rewards for the calls it
            brings are paid to this sign-in wallet.
          </p>
        </form>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm break-all">{value}</dd>
    </div>
  );
}
