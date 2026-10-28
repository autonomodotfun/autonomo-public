import type { Metadata } from "next";
import Link from "next/link";
import { listOwnerGateways } from "@/lib/gateway";
import { fmtAutonomo, fmtUsdg, shortAddr } from "@/lib/gateway-format";
import { platform } from "@/lib/pro";
import { authEnabled, currentOwner } from "@/lib/session";
import { Badge } from "./badge";
import { ConnectWallet, SignOut } from "./connect-wallet";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardPage() {
  const owner = await currentOwner();

  if (!owner) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-16 sm:px-6">
        <p className="font-mono text-xs tracking-wide text-accent uppercase">Launch dashboard</p>
        <h1 className="heading mt-2 text-4xl">Launch your API in minutes</h1>
        <p className="mt-4 text-muted">
          Put any existing API behind an Autonomo gateway, set a price per call, and AI agents pay you in USDG or
          $AUTONOMO with every request. No code changes, and payments go straight to your wallet.
        </p>
        <ol className="mt-6 list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>Connect the wallet you want to get paid in.</li>
          <li>Paste your API&apos;s URL and set a price.</li>
          <li>Share your gateway URL with agents, or list it in the catalog.</li>
        </ol>
        <div className="mt-8">
          {authEnabled() ? (
            <ConnectWallet />
          ) : (
            <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
              Wallet sign-in isn&apos;t enabled on this deployment yet.
            </p>
          )}
        </div>
        <p className="mt-6 text-sm text-muted">
          Already run x402 yourself? <Link href="/submit" className="underline hover:text-ink">List your endpoint</Link> instead.
        </p>
      </div>
    );
  }

  const rows = await listOwnerGateways(owner);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-wide text-accent uppercase">Launch dashboard</p>
          <h1 className="heading mt-1 text-4xl">Your APIs</h1>
          <p className="mt-1 font-mono text-xs text-muted">
            {shortAddr(owner)} · <SignOut />
          </p>
        </div>
        <Link href="/dashboard/new" className="btn-brand px-4 py-2 text-sm">
          Launch an API
        </Link>
      </div>

      {!platform.robinhood && (
        <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
          Payments aren&apos;t switched on for this deployment yet, so gateways answer <code>503</code> until they are.
          You can still set everything up now.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line p-10 text-center">
          <p className="text-muted">You haven&apos;t launched an API yet.</p>
          <Link href="/dashboard/new" className="mt-4 inline-block underline">Launch your first API</Link>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line rounded-lg border border-line">
          {rows.map(({ gateway: g, last30 }) => (
            <li key={g.id}>
              <Link href={`/dashboard/${g.slug}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 hover:bg-surface">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{g.name}</span>
                    <Badge tone={g.status === "active" ? "ok" : "muted"}>{g.status}</Badge>
                    {g.listing !== "unlisted" && <Badge tone={g.listing === "listed" ? "ok" : "muted"}>{g.listing}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-faint">/x/{g.slug}</p>
                </div>
                <Stat label="Paid calls, 30d" value={String(last30?.settled ?? 0)} />
                <Stat label="USDG, 30d" value={fmtUsdg(last30?.usdg)} />
                <Stat label="$AUTONOMO, 30d" value={fmtAutonomo(last30?.autonomo).replace(" AUTONOMO", "")} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-28 text-right">
      <div className="font-mono text-sm">{value}</div>
      <div className="text-xs text-faint">{label}</div>
    </div>
  );
}
