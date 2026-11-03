import type { Metadata } from "next";
import Link from "next/link";
import { VerifiedBadge } from "@/components/verified";
import { verifiedStatus } from "@/lib/verified";
import { notFound, redirect } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { TOKEN } from "@/lib/constants";
import { gatewayOffers, gatewayStats, getOwnedGateway, payeeOf, secretsEnabled } from "@/lib/gateway";
import { fmtAutonomo, fmtRail, fmtUsdg, shortAddr } from "@/lib/gateway-format";
import { platform } from "@/lib/pro";
import { currentOwner } from "@/lib/session";
import { deleteGateway, requestListing, setGatewayStatus } from "../actions";
import { Badge } from "../badge";
import { GatewayForm } from "../gateway-form";

export const metadata: Metadata = { title: "API dashboard", robots: { index: false } };

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

export default async function GatewayDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string; launched?: string }>;
}) {
  const flags = await searchParams;
  const owner = await currentOwner();
  if (!owner) redirect("/dashboard");
  const g = await getOwnedGateway((await params).slug, owner);
  if (!g) notFound();
  const [stats, { verified }] = await Promise.all([gatewayStats(g.id), verifiedStatus(payeeOf(g))]);
  const live = gatewayOffers(g);
  const url = `${SITE}/x/${g.slug}`;

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    const row = stats.daily.find((r) => r.day === d);
    return { day: d, calls: row?.calls ?? 0, settled: row?.settled ?? 0 };
  });
  const peak = Math.max(1, ...days.map((d) => d.calls));
  const successRate = stats.last30.calls ? Math.round((stats.last30.settled / stats.last30.calls) * 100) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Your APIs</Link>
      {(flags.launched === "1" || flags.saved === "1") && (
        <div role="status" className="mt-4 rounded-lg border border-accent bg-accent-soft px-4 py-3 text-sm font-medium text-accent">
          {flags.launched === "1"
            ? "🚀 Your API is live. Share the gateway URL below with agents."
            : "✓ Changes saved. They apply to the very next call."}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="heading text-4xl">{g.name}</h1>
            {verified && <VerifiedBadge />}
            <Badge tone={g.status === "active" ? "ok" : "muted"}>{g.status}</Badge>
            {g.listing !== "unlisted" && <Badge tone={g.listing === "listed" ? "ok" : g.listing === "rejected" ? "warn" : "muted"}>{g.listing}</Badge>}
          </div>
          {g.description && <p className="mt-1 text-muted">{g.description}</p>}
        </div>
        <form action={setGatewayStatus}>
          <input type="hidden" name="id" value={g.id} />
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface">
            {g.status === "active" ? "Pause" : "Resume"}
          </button>
        </form>
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap select-all">{url}</code>
        <CopyButton text={url} label="Copy gateway URL" className="btn-brand shrink-0 px-3 py-1.5 text-xs" />
      </div>
      <p className="mt-2 text-xs text-faint">
        Forwards to <span className="font-mono">{g.upstreamUrl}</span> · pays {shortAddr(payeeOf(g))} ·{" "}
        {live.length
          ? live.map((o) => (o.kind === "autonomo" ? `${o.amount} AUTONOMO` : `$${o.priceUsd} ${o.kind.toUpperCase()}`)).join(" or ")
          : "no payment option available"}{" "}
        per call
      </p>
      {!platform.robinhood && (
        <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
          Payments aren&apos;t switched on for this deployment yet, so this gateway answers <code>503</code> for now.
        </p>
      )}

      <section className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Card label="Paid calls, 30 days" value={String(stats.last30.settled)} />
        <Card label="USDG earned, 30 days" value={fmtUsdg(stats.last30.usdg)} />
        <Card label="$AUTONOMO earned, 30 days" value={fmtAutonomo(stats.last30.autonomo).replace(" AUTONOMO", "")} />
        <Card label="Settled, 30 days" value={successRate === null ? "—" : `${successRate}%`} hint={`${stats.last30.calls} paid attempts`} />
      </section>
      <p className="mt-2 text-xs text-faint">
        All time: {stats.allTime.settled} paid calls · {fmtUsdg(stats.allTime.usdg)} USDG · {fmtAutonomo(stats.allTime.autonomo)}
      </p>

      <section className="mt-8">
        <h2 className="heading text-xl">Last 14 days</h2>
        <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="Paid calls per day for the last 14 days">
          {days.map((d) => (
            <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.settled} settled of ${d.calls}`}>
              <div className="rounded-t-sm bg-line" style={{ height: `${((d.calls - d.settled) / peak) * 100}%` }} />
              <div className="bg-brand" style={{ height: `${(d.settled / peak) * 100}%`, minHeight: d.settled ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
          <span>{days[0].day.slice(5)}</span>
          <span>yellow = settled, grey = not settled</span>
          <span>{days[13].day.slice(5)}</span>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="heading text-xl">Recent payments</h2>
        {stats.recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No paid calls yet. Try the command below to see the 402.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-faint">
                <tr>
                  {["Time (UTC)", "Request", "Status", "Amount", "Payer", "Tx"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono text-xs">
                {stats.recent.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{c.createdAt.toISOString().slice(5, 19).replace("T", " ")}</td>
                    <td className="max-w-56 truncate px-3 py-2">{c.method} {c.path}</td>
                    <td className={`px-3 py-2 ${c.status < 400 ? "" : "text-warn"}`}>{c.status}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.settled ? fmtRail(c.rail, c.amount) : <span className="text-faint">not settled</span>}</td>
                    <td className="px-3 py-2">{shortAddr(c.payer)}</td>
                    <td className="px-3 py-2">
                      {c.tx ? (
                        <a href={`${TOKEN.explorer}/tx/${c.tx}`} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                          {shortAddr(c.tx)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="heading text-xl">Try it</h2>
        <p className="mt-2 text-sm text-muted">
          Without payment, the gateway answers <code>402 Payment Required</code> with the price. An x402 client (see the{" "}
          <Link href="/docs#agents" className="underline">docs</Link>) pays and retries automatically.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface p-4 font-mono text-[13px]">curl -i {url}/</pre>
      </section>

      <section className="mt-10 grid gap-10 lg:grid-cols-[1fr_18rem]">
        <div>
          <h2 className="heading text-xl">Settings</h2>
          <div className="mt-4">
            <GatewayForm
              site={SITE}
              secretsEnabled={secretsEnabled()}
              secretSet={Boolean(g.upstreamAuthSecret)}
              defaults={{
                id: g.id,
                name: g.name,
                slug: g.slug,
                description: g.description,
                upstreamUrl: g.upstreamUrl,
                authHeader: g.upstreamAuthHeader ?? "",
                priceUsd: Number(g.priceUsd) > 0 ? String(Number(g.priceUsd)) : "0.01",
                acceptUsdg: g.acceptUsdg,
                autonomoAmount: g.autonomoAmount ?? "",
              }}
            />
          </div>
        </div>
        <aside className="space-y-6">
          <div className="rounded-lg border border-line p-4">
            <h3 className="font-medium">Catalog listing</h3>
            <p className="mt-1 text-sm text-muted">
              {
                {
                  unlisted: "List this API in the Autonomo catalog so agents can discover it.",
                  pending: "Waiting for review.",
                  listed: "Listed in the catalog.",
                  rejected: "The listing wasn't approved. Update the details and request again.",
                }[g.listing]
              }
            </p>
            {(g.listing === "unlisted" || g.listing === "rejected") && (
              <form action={requestListing} className="mt-3">
                <input type="hidden" name="id" value={g.id} />
                <button className="btn-brand px-3 py-1.5 text-xs">Request listing</button>
              </form>
            )}
          </div>
          <div className="rounded-lg border border-line p-4">
            <h3 className="font-medium">How agents pay</h3>
            <p className="mt-1 text-sm text-muted">
              USDG payments are a single signature. {TOKEN.symbol} payments use Permit2, so a payer approves it once before
              their first call. Settlement happens on {TOKEN.chainName}.
            </p>
          </div>
          <form action={deleteGateway} className="rounded-lg border border-line p-4">
            <h3 className="font-medium text-warn">Delete this API</h3>
            <p className="mt-1 text-sm text-muted">
              The gateway URL stops working immediately. Type <span className="font-mono">{g.slug}</span> to confirm.
            </p>
            <input type="hidden" name="id" value={g.id} />
            <input name="confirm" aria-label="Type the gateway name to confirm" className="field mt-3" autoComplete="off" />
            <button className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs text-warn hover:bg-surface">Delete</button>
          </form>
        </aside>
      </section>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-bg p-4">
      <div className="font-mono text-2xl">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </div>
  );
}
