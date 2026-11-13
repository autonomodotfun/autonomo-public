import type { Metadata } from "next";
import Link from "next/link";
import { VerifiedBadge } from "@/components/verified";
import { verifiedStatus } from "@/lib/verified";
import { listOwnerGateways, payeeOf } from "@/lib/gateway";
import { fmtAutonomo, fmtUsdg, shortAddr } from "@/lib/gateway-format";
import { burnPercent } from "@/lib/burn";
import { platform } from "@/lib/payments";
import { privyEnabled } from "@/lib/privy";
import { authEnabled, currentOwner } from "@/lib/session";
import { Badge } from "./badge";
import { ConnectWallet, SignOut } from "./connect-wallet";
import { PayoutWallet } from "./payout-wallet";
import { PrivySignIn, PrivySignOut } from "./privy";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ payTo?: string; payToNote?: string }> }) {
  const owner = await currentOwner();
  const params = await searchParams;

  if (!owner) {
    return (
      <div className="mx-auto max-w-4xl px-4 pt-16 sm:px-6">
        <p className="font-mono text-xs tracking-wide text-accent uppercase">For API creators</p>
        <h1 className="heading mt-2 text-4xl">Get paid by AI agents for your API</h1>
        <p className="mt-4 text-muted">There are two ways in. Pick the one that describes your API today.</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-accent p-5">
            <p className="font-mono text-xs tracking-wide text-accent uppercase">Most creators start here</p>
            <h2 className="heading mt-2 text-2xl">I have a normal API</h2>
            <p className="mt-2 text-sm text-muted">
              It works with an API key, or with no key at all. We give it a paid address, you set a price per call, and
              agents pay you in USDG or $AUTONOMO. You don&apos;t change any code.
            </p>
            <Flow steps={["Agent", "Autonomo collects the payment", "Your API"]} highlight={1} />
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted">
              <li>Sign in. If you don&apos;t have a wallet, we create one for you.</li>
              <li>Paste your API&apos;s address and set a price.</li>
              <li>Share your paid address with agents, or ask to be listed.</li>
            </ol>
            <p className="mt-3 text-sm text-muted">
              {burnPercent()
                ? `You keep ${100 - burnPercent()!}% of every payment. The other ${burnPercent()}% is burned, and Autonomo keeps none of it.`
                : "Payments go straight to your wallet. Autonomo takes no cut."}
            </p>
            <div className="mt-5">
              {authEnabled() && privyEnabled() ? (
                <>
                  <PrivySignIn />
                  <details className="mt-4 text-sm text-muted">
                    <summary className="cursor-pointer hover:text-ink">Or sign in directly with a browser wallet</summary>
                    <div className="mt-3">
                      <ConnectWallet />
                    </div>
                  </details>
                </>
              ) : authEnabled() ? (
                <ConnectWallet />
              ) : (
                <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
                  Wallet sign-in isn&apos;t enabled on this deployment yet.
                </p>
              )}
            </div>
            <p className="mt-4 text-sm text-muted">
              New to this? Follow the <Link href="/docs/launch" className="underline hover:text-ink">step-by-step launch guide</Link>.
            </p>
          </section>

          <section className="rounded-lg border border-line p-5">
            <p className="font-mono text-xs tracking-wide text-faint uppercase">Already taking payments</p>
            <h2 className="heading mt-2 text-2xl">My API already takes x402 payments</h2>
            <p className="mt-2 text-sm text-muted">
              You run x402 yourself and want agents to find you. We add your API to the directory. Nothing changes in how
              you get paid, and there&apos;s nothing to sign in to.
            </p>
            <Flow steps={["Agent", "Your API collects the payment"]} />
            <p className="mt-4 text-sm text-muted">
              Autonomo only shows your API to agents. The payment never passes through us, so there&apos;s no dashboard
              and nothing to set up.
            </p>
            <p className="mt-3 text-sm text-muted">This is also where to send a tool, an SDK, a wallet or an agent.</p>
            <Link href="/submit" className="mt-5 inline-block rounded-md border border-line px-5 py-2.5 text-sm font-medium hover:bg-surface">
              List my project
            </Link>
          </section>
        </div>

        <h2 className="heading mt-12 text-2xl">The difference, side by side</h2>
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line font-mono text-xs tracking-wide text-faint uppercase">
              <tr>
                <th className="p-3 font-normal" />
                <th className="p-3 font-normal text-accent">Launch through us</th>
                <th className="p-3 font-normal">List your project</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-muted">
              {COMPARE.map(([label, launch, list]) => (
                <tr key={label}>
                  <th className="p-3 align-top font-medium text-ink">{label}</th>
                  <td className="p-3 align-top">{launch}</td>
                  <td className="p-3 align-top">{list}</td>
                </tr>
              ))}
              {burnPercent() && (
                <tr>
                  <th className="p-3 align-top font-medium text-ink">$AUTONOMO burned</th>
                  <td className="p-3 align-top">{burnPercent()}% of every payment</td>
                  <td className="p-3 align-top">None</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted">
          Both end up in the same <Link href="/projects" className="underline hover:text-ink">directory</Link> that agents
          search. An API launched through us starts hidden, so only people with its address can call it. You ask to be
          listed from your dashboard once it works.
        </p>
      </div>
    );
  }

  const rows = await listOwnerGateways(owner);
  const holders = [...new Set(rows.map((r) => payeeOf(r.gateway)))];
  const verified = new Map(await Promise.all(holders.map(async (h) => [h, (await verifiedStatus(h)).verified] as const)));

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-wide text-accent uppercase">Launch dashboard</p>
          <h1 className="heading mt-1 text-4xl">Your APIs</h1>
          <p className="mt-1 font-mono text-xs text-muted">
            {shortAddr(owner)} · {privyEnabled() ? <PrivySignOut /> : <SignOut />}
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
                    {verified.get(payeeOf(g)) && <VerifiedBadge />}
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

      {rows.length > 0 && burnPercent() && <p className="mt-2 text-xs text-faint">Earnings are your share after the {burnPercent()}% burn.</p>}

      {rows.length > 0 && <PayoutWallet owner={owner} payee={payeeOf(rows[0].gateway)} draft={params.payTo} note={params.payToNote} />}
    </div>
  );
}

// The two ways in, row by row: [what, launching through a gateway, listing only].
const COMPARE: [string, string, string][] = [
  ["Who it's for", "An API that doesn't take crypto payments yet", "An API that already takes x402 payments, or a tool, SDK, wallet or agent"],
  ["What we do", "Run a paid address for your API", "Add your project to the directory"],
  ["Who collects the payment", "Autonomo, then it's sent on to your wallet", "You, on your own server"],
  ["Sign-in", "Yes", "No, a short form we review by hand"],
  ["What you get", "A dashboard with paid calls, earnings and settings", "A page in the directory"],
];

/** Who the agent's money passes through, as a row of boxes joined by arrows. */
function Flow({ steps, highlight }: { steps: string[]; highlight?: number }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs" aria-label={steps.join(", then ")}>
      {steps.map((step, i) => (
        <span key={step} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-faint">→</span>}
          <span className={`rounded-md border px-2 py-1 ${i === highlight ? "border-accent text-accent" : "border-line text-muted"}`}>{step}</span>
        </span>
      ))}
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
