import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { connection } from "next/server";
import { isAddress } from "viem";
import { getDb, schema } from "@/db";
import { CATEGORY_INFO } from "@/lib/categories";
import { payeeOf } from "@/lib/gateway";
import { isContractWallet, safeInfo, verifiedStatus } from "@/lib/verified";
import {
  approveGateway,
  approvePayToRequest,
  approveSubmission,
  rejectGateway,
  rejectPayToRequest,
  rejectSubmission,
  setCreatorPayTo,
  setProjectFlags,
  switchCreatorWallet,
} from "./actions";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

type SearchParams = Promise<{ from?: string; to?: string; switch?: string; owner?: string; payTo?: string; payToNote?: string; requestNote?: string }>;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const db = await getDb();
  const params = await searchParams;
  const [pending, recent, gatewayRequests, switches] = await Promise.all([
    db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.status, "pending"))
      .orderBy(desc(schema.submissions.createdAt))
      .limit(100),
    db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.status, "approved"))
      .orderBy(desc(schema.submissions.reviewedAt))
      .limit(10),
    db
      .select()
      .from(schema.gateways)
      .where(eq(schema.gateways.listing, "pending"))
      .orderBy(desc(schema.gateways.updatedAt))
      .limit(100),
    db.select().from(schema.walletSwitches).orderBy(desc(schema.walletSwitches.createdAt)).limit(20),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6">
      <h1 className="heading text-3xl">Review queue</h1>
      <p className="mt-1 text-sm text-muted">{pending.length} pending submissions</p>

      <ul className="mt-6 space-y-4">
        {pending.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">
                {s.name} <span className="text-sm font-normal text-faint">· {CATEGORY_INFO[s.category]?.label}</span>
              </h2>
              <time className="text-xs text-faint">{s.createdAt.toISOString().slice(0, 16).replace("T", " ")}</time>
            </div>
            {s.reviewNote && <p className="mt-1 text-sm text-warn">{s.reviewNote}</p>}
            <p className="mt-2 text-sm text-muted">{s.description}</p>
            <dl className="mt-3 grid gap-1 font-mono text-xs text-muted">
              {[
                ["website", s.website],
                ["github", s.github],
                ["x", s.twitter],
                ["endpoint", s.endpointUrl],
                ["contact", s.contact],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-16 text-faint">{k}</dt>
                    <dd className="break-all">{v}</dd>
                  </div>
                ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={approveSubmission}>
                <input type="hidden" name="id" value={s.id} />
                <button className="btn-brand px-3 py-1.5 text-sm">Approve &amp; publish</button>
              </form>
              <form action={rejectSubmission} className="flex gap-2">
                <input type="hidden" name="id" value={s.id} />
                <input name="note" placeholder="Reason (optional)" className="field w-48 py-1.5" />
                <button className="rounded-md border border-line px-3 py-1.5 text-sm">Reject</button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Gateway listing requests</h2>
        <p className="mt-1 text-sm text-muted">{gatewayRequests.length} hosted APIs waiting to be listed in the catalog</p>
        <ul className="mt-4 space-y-4">
          {gatewayRequests.map((g) => (
            <li key={g.id} className="rounded-lg border border-line bg-surface p-5">
              <h3 className="font-medium">
                {g.name} <span className="font-mono text-sm font-normal text-faint">/x/{g.slug}</span>
              </h3>
              {g.description && <p className="mt-1 text-sm text-muted">{g.description}</p>}
              <dl className="mt-3 grid gap-1 font-mono text-xs text-muted">
                {[
                  ["upstream", g.upstreamUrl],
                  ["owner", g.owner],
                  ["price", `${g.acceptUsdg ? `$${Number(g.priceUsd)} USDG` : ""}${g.acceptUsdg && g.autonomoAmount ? " · " : ""}${g.autonomoAmount ? `${g.autonomoAmount} AUTONOMO` : ""}`],
                  ["status", g.status],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-16 text-faint">{k}</dt>
                    <dd className="break-all">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex gap-2">
                <form action={approveGateway}>
                  <input type="hidden" name="id" value={g.id} />
                  <button className="btn-brand px-3 py-1.5 text-sm">List in catalog</button>
                </form>
                <form action={rejectGateway}>
                  <input type="hidden" name="id" value={g.id} />
                  <button className="rounded-md border border-line px-3 py-1.5 text-sm">Reject</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Update a project</h2>
        <form action={setProjectFlags} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            Slug
            <input name="slug" required className="field w-56" placeholder="e.g. corbits" />
          </label>
          <label className="grid gap-1">
            Visibility
            <select name="status" className="field w-36" defaultValue="">
              <option value="">No change</option>
              <option value="approved">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </label>
          <label className="grid gap-1">
            Featured
            <select name="featured" className="field w-36" defaultValue="">
              <option value="">No change</option>
              <option value="on">Featured</option>
              <option value="off">Not featured</option>
            </select>
          </label>
          <button className="btn-brand px-3 py-2">Save</button>
        </form>
      </section>

      <PayToRequests message={params.requestNote} />

      <SetPayTo owner={params.owner} payTo={params.payTo} message={params.payToNote} />

      <SwitchWallet from={params.from} to={params.to} message={params.switch} switches={switches} />

      {recent.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-semibold">Recently approved</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {recent.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
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
    <section id="pay-to-requests" className="mt-12 scroll-mt-6">
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
