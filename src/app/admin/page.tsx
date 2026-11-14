import { desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { isAddress } from "viem";
import { getDb, schema } from "@/db";
import { payeeOf } from "@/lib/gateway";
import { isContractWallet, safeInfo, verifiedStatus } from "@/lib/verified";
import { approvePayToRequest, rejectPayToRequest, setCreatorPayTo, switchCreatorWallet } from "./actions";
import { ApisTab, type ApiFilter } from "./apis";
import { HistoryTab } from "./history";
import { ReviewTab } from "./review";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

type SearchParams = Promise<{
  tab?: string;
  q?: string;
  show?: string;
  group?: string;
  from?: string;
  to?: string;
  switch?: string;
  owner?: string;
  payTo?: string;
  payToNote?: string;
  requestNote?: string;
}>;

const TABS = { review: "Review", apis: "All APIs", payouts: "Payouts", history: "History" } as const;
type Tab = keyof typeof TABS;
const API_FILTERS: ApiFilter[] = ["all", "listed", "pending", "unlisted", "rejected", "paused"];

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const db = await getDb();
  const params = await searchParams;
  const tab: Tab = params.tab && params.tab in TABS ? (params.tab as Tab) : "review";
  const { gateways, submissions, payToRequests } = schema;
  const n = sql<number>`count(*)::int`;
  const [[apisWaiting], [subsWaiting], [payoutsWaiting], [live]] = await Promise.all([
    db.select({ n }).from(gateways).where(eq(gateways.listing, "pending")),
    db.select({ n }).from(submissions).where(eq(submissions.status, "pending")),
    db.select({ n }).from(payToRequests).where(eq(payToRequests.status, "pending")),
    db.select({ n, active: sql<number>`count(*) filter (where ${gateways.status} = 'active')::int` }).from(gateways),
  ]);
  const waiting = apisWaiting.n + subsWaiting.n + payoutsWaiting.n;
  const badge: Partial<Record<Tab, number>> = { review: apisWaiting.n + subsWaiting.n, payouts: payoutsWaiting.n };

  return (
    <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6">
      <h1 className="heading text-3xl">Admin</h1>
      <p className="mt-1 text-sm text-muted">
        {waiting === 0 ? "Nothing is waiting for you." : `${waiting} ${waiting === 1 ? "thing is" : "things are"} waiting for you.`}
      </p>

      <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href="/admin?tab=review" count={apisWaiting.n} label={apisWaiting.n === 1 ? "API to review" : "APIs to review"} needsYou={apisWaiting.n > 0} />
        <Tile href="/admin?tab=review#submissions" count={subsWaiting.n} label={subsWaiting.n === 1 ? "Directory submission" : "Directory submissions"} needsYou={subsWaiting.n > 0} />
        <Tile href="/admin?tab=payouts" count={payoutsWaiting.n} label={payoutsWaiting.n === 1 ? "Payout request" : "Payout requests"} needsYou={payoutsWaiting.n > 0} />
        <Tile href="/admin?tab=apis" count={live.active} label={`of ${live.n} ${live.n === 1 ? "API" : "APIs"} taking payments`} />
      </ul>

      <nav aria-label="Admin sections" className="-mx-4 mt-8 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1 border-b border-line text-sm whitespace-nowrap">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <li key={t}>
              <Link
                href={t === "review" ? "/admin" : `/admin?tab=${t}`}
                aria-current={tab === t ? "page" : undefined}
                className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 ${tab === t ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {TABS[t]}
                {badge[t] ? <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-on-brand">{badge[t]}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8">
        {tab === "review" && <ReviewTab />}
        {tab === "apis" && <ApisTab q={(params.q ?? "").trim().slice(0, 80)} show={API_FILTERS.includes(params.show as ApiFilter) ? (params.show as ApiFilter) : "all"} />}
        {tab === "payouts" && (
          <>
            <PayToRequests message={params.requestNote} />
            <SetPayTo owner={params.owner} payTo={params.payTo} message={params.payToNote} />
            <SwitchWallet from={params.from} to={params.to} message={params.switch} switches={await db.select().from(schema.walletSwitches).orderBy(desc(schema.walletSwitches.createdAt)).limit(20)} />
          </>
        )}
        {tab === "history" && <HistoryTab group={params.group ?? "all"} />}
      </div>
    </div>
  );
}

function Tile({ href, count, label, needsYou = false }: { href: string; count: number; label: string; needsYou?: boolean }) {
  return (
    <li>
      <Link href={href} className={`block h-full rounded-lg border p-4 hover:border-faint ${needsYou ? "border-brand bg-surface" : "border-line"}`}>
        <span className={`block font-mono text-2xl ${needsYou ? "text-ink" : "text-muted"}`}>{count}</span>
        <span className="mt-1 block text-sm text-muted">{label}</span>
      </Link>
    </li>
  );
}

// Creators asking from the dashboard to move their APIs from the Safe they set to another. Their first Safe needs no
// approval: they set it with a signature. Shows what the chain says about the new Safe, so it can be checked against
// what the creator told us before approving.
async function PayToRequests({ message }: { message?: string }) {
  const db = await getDb();
  const { payToRequests, gateways } = schema;
  const pending = await db.select().from(payToRequests).where(eq(payToRequests.status, "pending")).orderBy(desc(payToRequests.createdAt)).limit(50);
  const details = await Promise.all(
    pending.map(async (r) => {
      const [safe, status, apis] = await Promise.all([
        safeInfo(r.payTo).catch(() => undefined),
        verifiedStatus(r.payTo),
        db.select({ slug: gateways.slug, owner: gateways.owner, payTo: gateways.payTo }).from(gateways).where(eq(gateways.owner, r.owner)),
      ]);
      return { r, safe, status, apis };
    }),
  );

  return (
    <section id="pay-to-requests" className="scroll-mt-6">
      <h2 className="text-lg font-semibold">Payout wallet requests</h2>
      <p className="mt-1 text-sm text-muted">{pending.length} {pending.length === 1 ? "creator" : "creators"} asking to move their APIs to another Safe</p>
      {message && <p className="mt-3 rounded-md border border-line bg-surface p-3 text-sm">{message}</p>}
      <ul className="mt-4 space-y-4">
        {details.map(({ r, safe, status, apis }) => (
          <li key={r.id} className="rounded-lg border border-line bg-surface p-5 text-sm">
            <dl className="grid gap-1 font-mono text-xs text-muted">
              {[
                ["owner", r.owner],
                ["safe", r.payTo],
                ["asked", r.createdAt.toISOString().slice(0, 16).replace("T", " ")],
                ["apis", apis.length ? apis.map((a) => `/x/${a.slug}`).join(", ") : "none"],
                ["now pays", apis.length ? [...new Set(apis.map(payeeOf))].join(", ") : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-20 shrink-0 text-faint">{k}</dt>
                  <dd className="break-all">{v}</dd>
                </div>
              ))}
            </dl>
            <ul className="mt-3 grid gap-1 text-muted">
              {safe === undefined && <li className="text-warn">Couldn&apos;t read the chain. Check the Safe before approving.</li>}
              {safe === null && <li className="text-warn">This address isn&apos;t a Safe on Robinhood Chain.</li>}
              {safe && (
                <>
                  <li>
                    Safe {safe.version}, {safe.threshold} of {safe.owners.length} signers:
                    <span className="block font-mono text-xs break-all">{safe.owners.join(", ")}</span>
                  </li>
                  {safe.threshold < 2 && <li className="text-warn">Only one signature moves the money, so it isn&apos;t a real multisig.</li>}
                  {safe.owners.includes(r.owner) && <li>The sign-in wallet is one of the signers.</li>}
                </>
              )}
              {status.verified ? (
                <li>The Safe holds enough for Verified.</li>
              ) : (
                <li className="text-warn">
                  The Safe holds {status.balance ?? "an unknown amount of"} $AUTONOMO and needs {status.required ?? "the Verified amount"}, so these APIs
                  would lose Verified.
                </li>
              )}
            </ul>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <form action={approvePayToRequest} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={r.id} />
                <label className="grid gap-1">
                  Type the Safe&apos;s last 6 characters
                  <input name="confirm" required autoComplete="off" spellCheck={false} className="field w-40 py-1.5 font-mono" />
                </label>
                <button className="btn-brand px-3 py-1.5">Approve</button>
              </form>
              <form action={rejectPayToRequest} className="flex gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input name="note" placeholder="Reason (shown to the creator)" className="field w-56 py-1.5" />
                <button className="rounded-md border border-line px-3 py-1.5">Reject</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function SetPayTo({ owner: rawOwner, payTo: rawPayTo, message }: { owner?: string; payTo?: string; message?: string }) {
  const owner = rawOwner?.trim().toLowerCase() ?? "";
  const payTo = rawPayTo?.trim().toLowerCase() ?? "";
  const ready = isAddress(owner) && isAddress(payTo);
  const db = await getDb();
  const [gateways, status] = ready
    ? await Promise.all([
        db.select({ slug: schema.gateways.slug, owner: schema.gateways.owner, payTo: schema.gateways.payTo }).from(schema.gateways).where(eq(schema.gateways.owner, owner)),
        verifiedStatus(payTo),
      ])
    : [[], null];

  return (
    <section id="pay-to" className="mt-12">
      <h2 className="text-lg font-semibold">Set where an API creator gets paid</h2>
      <p className="mt-1 text-sm text-muted">
        All of a wallet&apos;s APIs pay the wallet you name here, such as a Safe, and it holds the tokens for Verified. The
        creator keeps signing in with their own wallet. Name their own wallet to undo this.
      </p>
      {message && <p className="mt-3 rounded-md border border-line bg-surface p-3 text-sm">{message}</p>}
      <form className="mt-3 grid gap-3 text-sm sm:max-w-xl">
        <input type="hidden" name="tab" value="payouts" />
        <label className="grid gap-1">
          Sign-in wallet
          <input name="owner" required defaultValue={owner} placeholder="0x…" spellCheck={false} className="field font-mono" />
        </label>
        <label className="grid gap-1">
          Pay-to wallet
          <input name="payTo" required defaultValue={payTo} placeholder="0x…" spellCheck={false} className="field font-mono" />
        </label>
        <div>
          <button className="rounded-md border border-line px-3 py-2">Preview</button>
        </div>
      </form>

      {ready && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-5 text-sm">
          {gateways.length === 0 ? (
            <p>That wallet has no APIs, so there&apos;s nothing to change.</p>
          ) : (
            <>
              <p className="font-medium">
                {gateways.length} {gateways.length === 1 ? "API" : "APIs"} will pay {payTo === owner ? "the sign-in wallet again" : "this wallet"}:
              </p>
              <ul className="mt-2 grid gap-1 font-mono text-xs break-all text-muted">
                {gateways.map((g) => (
                  <li key={g.slug}>
                    /x/{g.slug}, now paying {payeeOf(g)}
                  </li>
                ))}
              </ul>
              <ul className="mt-3 grid gap-1 text-muted">
                {status?.verified === false && (
                  <li className="text-warn">
                    The pay-to wallet holds {status.balance ?? "an unknown amount of"} $AUTONOMO and needs{" "}
                    {status.required ?? "the Verified amount"}, so these APIs would lose Verified.
                  </li>
                )}
                {status?.verified && <li>The pay-to wallet holds enough for Verified.</li>}
              </ul>
              <form action={setCreatorPayTo} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="owner" value={owner} />
                <input type="hidden" name="payTo" value={payTo} />
                <label className="grid gap-1">
                  Type the pay-to wallet&apos;s last 6 characters
                  <input name="confirm" required autoComplete="off" spellCheck={false} className="field w-48 font-mono" />
                </label>
                <button className="btn-brand px-3 py-2">Set pay-to</button>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}

async function SwitchWallet({
  from: rawFrom,
  to: rawTo,
  message,
  switches,
}: {
  from?: string;
  to?: string;
  message?: string;
  switches: (typeof schema.walletSwitches.$inferSelect)[];
}) {
  const from = rawFrom?.trim().toLowerCase() ?? "";
  const to = rawTo?.trim().toLowerCase() ?? "";
  const ready = isAddress(from) && isAddress(to) && from !== to;
  const db = await getDb();
  const [moving, status, contract] = ready
    ? await Promise.all([
        db.select({ slug: schema.gateways.slug, payTo: schema.gateways.payTo }).from(schema.gateways).where(eq(schema.gateways.owner, from)),
        verifiedStatus(to),
        isContractWallet(to),
      ])
    : [[], null, false];
  const paysOwner = moving.some((g) => !g.payTo);

  return (
    <section id="switch-wallet" className="mt-12">
      <h2 className="text-lg font-semibold">Switch an API creator&apos;s wallet</h2>
      <p className="mt-1 text-sm text-muted">
        Moves all of a wallet&apos;s APIs to a new wallet, which then signs in for them and gets paid unless they have a
        separate pay-to wallet. Payments already made stay where they went.
      </p>
      {message && <p className="mt-3 rounded-md border border-line bg-surface p-3 text-sm">{message}</p>}
      <form className="mt-3 grid gap-3 text-sm sm:max-w-xl">
        <input type="hidden" name="tab" value="payouts" />
        <label className="grid gap-1">
          Current wallet
          <input name="from" required defaultValue={from} placeholder="0x…" spellCheck={false} className="field font-mono" />
        </label>
        <label className="grid gap-1">
          New wallet
          <input name="to" required defaultValue={to} placeholder="0x…" spellCheck={false} className="field font-mono" />
        </label>
        <div>
          <button className="rounded-md border border-line px-3 py-2">Preview</button>
        </div>
      </form>

      {ready && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-5 text-sm">
          {moving.length === 0 ? (
            <p>That wallet has no APIs, so there&apos;s nothing to move.</p>
          ) : (
            <>
              <p className="font-medium">
                {moving.length} {moving.length === 1 ? "API" : "APIs"} will move:
              </p>
              <ul className="mt-2 grid gap-1 font-mono text-xs text-muted">
                {moving.map((g) => (
                  <li key={g.slug}>/x/{g.slug}</li>
                ))}
              </ul>
              <ul className="mt-3 grid gap-1 text-muted">
                {!paysOwner && <li>These APIs keep paying their pay-to wallet, which holds for Verified.</li>}
                {paysOwner && status?.verified === false && (
                  <li className="text-warn">
                    The new wallet holds {status.balance ?? "an unknown amount of"} $AUTONOMO and needs{" "}
                    {status.required ?? "the Verified amount"}, so these APIs would lose Verified.
                  </li>
                )}
                {paysOwner && status?.verified && <li>The new wallet holds enough for Verified.</li>}
                {contract && (
                  <li className="text-warn">
                    The new wallet is a contract, such as a Safe. It can&apos;t sign in to manage these APIs. To keep the dashboard,
                    make it the pay-to wallet instead.
                  </li>
                )}
                {contract === null && <li className="text-warn">Couldn&apos;t check whether the new wallet is a contract.</li>}
              </ul>
              <form action={switchCreatorWallet} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                <label className="grid gap-1">
                  Type the new wallet&apos;s last 6 characters
                  <input name="confirm" required autoComplete="off" spellCheck={false} className="field w-48 font-mono" />
                </label>
                <button className="btn-brand px-3 py-2">Switch wallet</button>
              </form>
            </>
          )}
        </div>
      )}

      {switches.length > 0 && (
        <>
          <h3 className="mt-6 font-medium">Past switches</h3>
          <ul className="mt-2 grid gap-2 font-mono text-xs text-muted">
            {switches.map((s) => (
              <li key={s.id} className="break-all">
                {s.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {s.kind === "pay_to" ? "pay-to · " : s.kind === "pay_to_signed" ? "pay-to, signed by creator · " : ""}
                {s.fromOwner} → {s.toOwner} · {s.slugs.length} APIs
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
