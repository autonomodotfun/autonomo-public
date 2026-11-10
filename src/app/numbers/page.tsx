import type { Metadata } from "next";
import Link from "next/link";
import { retrySoon } from "@/lib/prerender";
import { getTrackRecords } from "@/lib/queries";
import { OFFICIAL_OWNER, TRACK_RECORD_DAYS } from "@/lib/track-record";

export const metadata: Metadata = {
  title: "Numbers",
  description: "Paid calls, refused payments, failures, payers and speed for each official Autonomo API.",
};

const fmt = new Intl.NumberFormat("en");
const speed = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const pct = (r: number | null) => (r === null ? "—" : `${Math.floor(r * 1000) / 10}%`);

export default async function NumbersPage() {
  let records: Awaited<ReturnType<typeof getTrackRecords>> | null = null;
  try {
    records = await getTrackRecords();
  } catch (e) {
    console.error("track records failed", e);
    await retrySoon();
  }
  const rows = Object.values(records ?? {})
    .filter((r) => r.owner === OFFICIAL_OWNER)
    .sort((a, b) => b.settledCalls - a.settledCalls || a.name.localeCompare(b.name));
  const sum = (k: "settledCalls" | "refusedCalls" | "failedCalls" | "settledAllTime") => rows.reduce((n, r) => n + r[k], 0);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">Numbers</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">The official APIs, in numbers</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Every call that comes with a payment, for each <Link href="/docs/official-apis">official API</Link>, over the last{" "}
        {TRACK_RECORD_DAYS} days. Updated every hour.
      </p>

      {records === null ? (
        <p className="mt-8 text-muted">The numbers can&apos;t be loaded right now. Try again in a few minutes.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">API</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Refused</th>
                <th className="px-4 py-2 text-right font-medium">Failed</th>
                <th className="px-4 py-2 text-right font-medium">Outside payers</th>
                <th className="px-4 py-2 text-right font-medium">Came back</th>
                <th className="px-4 py-2 text-right font-medium">Answered</th>
                <th className="px-4 py-2 text-right font-medium">Typical speed</th>
                <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Paid since launch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono">
              {rows.map((r) => (
                <tr key={r.gatewaySlug}>
                  <td className="px-4 py-3 font-sans whitespace-nowrap">
                    <Link href={`/projects/${r.projectSlug}`} className="hover:text-ink">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">{fmt.format(r.settledCalls)}</td>
                  <td className="px-4 py-3 text-right">{fmt.format(r.refusedCalls)}</td>
                  <td className="px-4 py-3 text-right">{fmt.format(r.failedCalls)}</td>
                  <td className="px-4 py-3 text-right">{fmt.format(r.outsidePayers)}</td>
                  <td className="px-4 py-3 text-right">{fmt.format(r.repeatPayers)}</td>
                  <td className="px-4 py-3 text-right">{pct(r.successRate)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{speed(r.medianMs)}</td>
                  <td className="px-4 py-3 text-right">{fmt.format(r.settledAllTime)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot className="border-t border-line bg-surface font-mono">
                <tr>
                  <td className="px-4 py-3 font-sans font-medium">All official APIs</td>
                  <td className="px-4 py-3 text-right">{fmt.format(sum("settledCalls"))}</td>
                  <td className="px-4 py-3 text-right">{fmt.format(sum("refusedCalls"))}</td>
                  <td className="px-4 py-3 text-right">{fmt.format(sum("failedCalls"))}</td>
                  <td colSpan={4} />
                  <td className="px-4 py-3 text-right">{fmt.format(sum("settledAllTime"))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <dl className="mt-8 grid max-w-3xl gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <Term name="Paid">The payment settled on-chain, so the payer was charged.</Term>
        <Term name="Refused">
          The payment was turned down before the API ran: invalid, too low, expired or not enough balance. Nobody was
          charged.
        </Term>
        <Term name="Failed">The payment was valid but the API didn&apos;t answer properly, so the payer wasn&apos;t charged.</Term>
        <Term name="Outside payers">
          Different wallets that paid. The API&apos;s own wallets and the team&apos;s test wallets don&apos;t count. The
          Playground and Telegram bot pay from one wallet, so they count as one payer.
        </Term>
        <Term name="Came back">Outside payers who paid on 2 or more different days.</Term>
        <Term name="Answered">The share of calls with a valid payment that the API answered without a server error.</Term>
      </dl>
      <p className="mt-6 max-w-3xl text-sm text-faint">
        Calls without a payment, where an agent only checks the price, aren&apos;t counted. Private payments through
        Gloam are counted as paid, but not as payers.
      </p>
    </div>
  );
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium">{name}</dt>
      <dd className="mt-0.5 text-muted">{children}</dd>
    </div>
  );
}
