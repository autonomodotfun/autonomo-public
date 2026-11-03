import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import { TOKEN } from "@/lib/constants";
import { shortAddr } from "@/lib/gateway-format";
import { privyEnabled } from "@/lib/privy";
import { safeInfo } from "@/lib/verified";
import { cancelPayToRequest, requestPayTo } from "./actions";
import { FirstSafeBrowser, FirstSafePrivy } from "./first-safe";

/**
 * On the dashboard: which wallet the owner's APIs pay. The first Safe is set with a signature from the sign-in wallet;
 * moving to another Safe after that is a request approved in /admin. The sign-in wallet keeps launching and managing
 * APIs either way.
 */
export async function PayoutWallet({ owner, payee, draft, note }: { owner: string; payee: string; draft?: string; note?: string }) {
  const db = await getDb();
  const [latest] = await db
    .select()
    .from(schema.payToRequests)
    .where(eq(schema.payToRequests.owner, owner))
    .orderBy(desc(schema.payToRequests.createdAt))
    .limit(1);
  const pending = latest?.status === "pending" ? latest : null;
  const rejected = latest?.status === "rejected" ? latest : null;
  const paysSafe = payee !== owner;
  const safe = paysSafe ? await safeInfo(payee).catch(() => null) : null;

  return (
    <section id="payout" className="mt-10 scroll-mt-6 rounded-lg border border-line p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading text-xl">Where your APIs get paid</h2>
        <Link href="/docs/safe" className="text-muted underline hover:text-ink">
          How to set up a Safe
        </Link>
      </div>
      <p className="mt-1 text-muted">
        Your sign-in wallet launches and manages your APIs. Payments can go to a separate Safe multisig on{" "}
        {TOKEN.chainName}, which also holds the {TOKEN.symbol} for Verified.
      </p>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-surface p-3">
          <dt className="text-xs text-faint">Sign-in wallet</dt>
          <dd className="mt-0.5 font-mono text-xs break-all">{owner}</dd>
        </div>
        <div className="rounded-md border border-line bg-surface p-3">
          <dt className="text-xs text-faint">Payments go to</dt>
          <dd className="mt-0.5 font-mono text-xs break-all">
            <a href={`${TOKEN.explorer}/address/${payee}`} target="_blank" rel="noreferrer" className="underline hover:text-ink">
              {payee}
            </a>
          </dd>
          <dd className="mt-1 text-xs text-muted">
            {!paysSafe
              ? "Your sign-in wallet"
              : safe
                ? `Safe, ${safe.threshold} of ${safe.owners.length} signers`
                : "A separate wallet"}
          </dd>
        </div>
      </dl>

      {note && (
        <p role="status" className="mt-4 rounded-md border border-line bg-surface p-3">
          {note}
        </p>
      )}

      {!paysSafe ? (
        privyEnabled() ? (
          <FirstSafePrivy owner={owner} />
        ) : (
          <FirstSafeBrowser owner={owner} />
        )
      ) : (
        <>
          {pending ? (
            <div className="mt-4 rounded-md border border-accent bg-accent-soft p-3">
              <p className="font-medium text-accent">Waiting for review</p>
              <p className="mt-1 text-muted">
                You asked to move your APIs to <span className="font-mono text-xs break-all text-ink">{pending.payTo}</span>.
                Until it&apos;s approved, they keep paying {shortAddr(payee)}.
              </p>
              <form action={cancelPayToRequest} className="mt-2">
                <button className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-surface">Cancel request</button>
              </form>
            </div>
          ) : (
            rejected && (
              <p className="mt-4 rounded-md border border-line p-3 text-muted">
                Your request for <span className="font-mono text-xs">{shortAddr(rejected.payTo)}</span> wasn&apos;t approved
                {rejected.reviewNote ? `: ${rejected.reviewNote}` : "."}
              </p>
            )
          )}

          <form action={requestPayTo} className="mt-4 grid gap-2 sm:max-w-xl">
            <label htmlFor="payTo" className="font-medium">
              {pending ? "Change the requested Safe" : "Move payments to another Safe"}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="payTo"
                name="payTo"
                required
                defaultValue={draft}
                placeholder="0x… Safe address on Robinhood Chain"
                spellCheck={false}
                autoComplete="off"
                className="field min-w-0 flex-1 font-mono"
              />
              <button className="btn-brand px-3 py-2">Request</button>
            </div>
            <p className="text-xs text-faint">
              Your Safe holds your earnings, so moving away from it is checked by hand before it applies. Payments already
              made stay where they went. To go back to your sign-in wallet, ask us on{" "}
              <a href="https://t.me/autonomodotfun" className="underline hover:text-ink">
                Telegram
              </a>
              .
            </p>
          </form>
        </>
      )}
    </section>
  );
}
