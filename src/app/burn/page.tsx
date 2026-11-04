import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TOKEN } from "@/lib/constants";
import { BURN_BPS, BURN_DEAD, burnEnabled, burnFactory, buybackBurner, getBurns } from "@/lib/burn";
import { fmtAutonomo, fmtUsdg, shortAddr } from "@/lib/gateway-format";

export const metadata: Metadata = {
  title: "Burn",
  description: `Every ${TOKEN.symbol} burn from paid API calls on Autonomo, with an on-chain receipt for each one.`,
};

const KINDS: Record<string, string> = { buyback: "USDG buyback", payment: `${TOKEN.symbol} payment`, other: "Other" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function BurnPage() {
  if (!burnEnabled()) notFound();
  const { totals, receipts } = await getBurns();
  const total = (kind: string) => totals.find((t) => t.kind === kind);
  const all = totals.reduce((sum, t) => sum + BigInt(t.burned), 0n).toString();
  const burn = BURN_BPS / 100;
  const contracts = [
    { label: "Splitter factory", address: burnFactory() },
    { label: "Buyback and burn", address: buybackBurner() },
    { label: "Dead address", address: BURN_DEAD },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">On-chain receipts</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">{TOKEN.symbol} burn</h1>
      <p className="mt-4 text-muted">
        {burn}% of each paid API call through an Autonomo gateway is burned. The rate is fixed in the contract. Burns run in
        daily batches, so one receipt can cover many calls.
      </p>

      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        <Stat label="Total burned" value={fmtAutonomo(all)} note={`${totals.reduce((n, t) => n + t.count, 0)} receipts`} />
        <Stat
          label="From USDG buybacks"
          value={fmtAutonomo(total("buyback")?.burned)}
          note={`${fmtUsdg(total("buyback")?.usdgIn)} of USDG spent buying ${TOKEN.symbol}`}
        />
        <Stat label={`From ${TOKEN.symbol} payments`} value={fmtAutonomo(total("payment")?.burned)} note="Burned directly, with no market buy" />
      </div>
      <p className="mt-3 text-sm text-muted">
        The Agent Playground and the Telegram bot pay from Autonomo&apos;s own wallet, so {TOKEN.symbol} payment burns include
        Autonomo&apos;s own tokens and aren&apos;t all outside demand.
      </p>

      <h2 className="heading mt-12 text-2xl">Where each paid call goes</h2>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Share of the payment</th>
              <th className="px-4 py-2 font-medium">Third-party APIs</th>
              <th className="px-4 py-2 font-medium">Official Autonomo APIs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            <Split label="Burned, directly or through a buyback" third={burn} official={burn} />
            <Split label="API creator" third={100 - burn} official={0} />
            <Split label="Autonomo team" third={0} official={100 - burn} />
            <Split label={`${TOKEN.symbol} holders`} third={0} official={0} />
            <Split label="Total" third={100} official={100} />
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        Autonomo&apos;s facilitator wallet pays the gas separately. Burning only takes a share of incoming payments, so it
        can&apos;t touch tokens a wallet holds for Verified.
      </p>

      <h2 className="heading mt-12 text-2xl">Receipts</h2>
      {receipts.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-3 text-muted">
          No burns yet. Each day&apos;s batch runs once a splitter holds at least 100 {TOKEN.symbol} or 0.10 USDG, and a buyback
          runs once 1 USDG is waiting.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Date (UTC)</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Burned</th>
                <th className="px-4 py-2 font-medium">USDG spent</th>
                <th className="px-4 py-2 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {receipts.map((r) => (
                <tr key={`${r.tx}-${r.logIndex}`}>
                  <td className="px-4 py-2 text-muted">{fmtDate(r.burnedAt)}</td>
                  <td className="px-4 py-2">{KINDS[r.kind] ?? r.kind}</td>
                  <td className="px-4 py-2">{fmtAutonomo(r.burned)}</td>
                  <td className="px-4 py-2 text-muted">{r.usdgIn ? fmtUsdg(r.usdgIn) : "—"}</td>
                  <td className="px-4 py-2">
                    <a href={`${TOKEN.explorer}/tx/${r.tx}`} className="font-mono text-xs underline hover:text-ink">
                      {shortAddr(r.tx)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {receipts.length >= 200 && <p className="mt-3 text-sm text-muted">Showing the latest 200. The totals cover every burn.</p>}

      <h2 className="heading mt-12 text-2xl">Check it yourself</h2>
      <ul className="mt-4 space-y-2 text-sm">
        {contracts.map(
          (c) =>
            c.address && (
              <li key={c.label}>
                <span className="text-muted">{c.label}: </span>
                <a href={`${TOKEN.explorer}/address/${c.address}`} className="font-mono break-all underline hover:text-ink">
                  {c.address}
                </a>
              </li>
            ),
        )}
      </ul>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-lg font-medium break-words text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function Split({ label, third, official }: { label: string; third: number; official: number }) {
  return (
    <tr>
      <td className="px-4 py-2">{label}</td>
      <td className="px-4 py-2 text-muted">{third}%</td>
      <td className="px-4 py-2 text-muted">{official}%</td>
    </tr>
  );
}
