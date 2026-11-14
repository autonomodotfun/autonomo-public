import { desc, eq, inArray, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { Suspense } from "react";
import { getDb, schema } from "@/db";
import { CATEGORY_INFO } from "@/lib/categories";
import { payeeOf, testGateway } from "@/lib/gateway";
import { testVerdict } from "@/lib/gateway-rules";
import { approveGateway, approveGateways, approveSubmission, rejectGateway, rejectSubmission } from "./actions";
import { SelectAll } from "./select-all";
import { Fact, when } from "./ui";

type Gateway = typeof schema.gateways.$inferSelect;

// Live checks run for this many waiting APIs; a longer queue shows the rest without them, so the page stays quick.
const CHECKED = 30;
const BULK_FORM = "list-selected";

/** The Review tab: APIs whose creators asked to be listed, then projects sent through the listing form. */
export async function ReviewTab() {
  const db = await getDb();
  const { gateways, gatewayCalls, submissions } = schema;
  const [waiting, pending] = await Promise.all([
    db.select().from(gateways).where(eq(gateways.listing, "pending")).orderBy(desc(gateways.updatedAt)).limit(100),
    db.select().from(submissions).where(eq(submissions.status, "pending")).orderBy(desc(submissions.createdAt)).limit(100),
  ]);

  // What else each creator has, and how much each waiting API has already been paid for.
  const owners = [...new Set(waiting.map((g) => g.owner))];
  const ids = waiting.map((g) => g.id);
  const [ownerRows, callRows] = await Promise.all([
    owners.length
      ? db
          .select({
            owner: gateways.owner,
            apis: sql<number>`count(*)::int`,
            listed: sql<number>`count(*) filter (where ${gateways.listing} = 'listed')::int`,
          })
          .from(gateways)
          .where(inArray(gateways.owner, owners))
          .groupBy(gateways.owner)
      : [],
    ids.length
      ? db
          .select({
            id: gatewayCalls.gatewayId,
            calls: sql<number>`count(*)::int`,
            settled: sql<number>`count(*) filter (where ${gatewayCalls.settled})::int`,
          })
          .from(gatewayCalls)
          .where(inArray(gatewayCalls.gatewayId, ids))
          .groupBy(gatewayCalls.gatewayId)
      : [],
  ]);
  const byOwner = new Map(ownerRows.map((r) => [r.owner, r]));
  const byApi = new Map(callRows.map((r) => [r.id, r]));
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">APIs waiting to be listed</h2>
            <p className="mt-1 text-sm text-muted">
              {waiting.length === 0
                ? "None. Creators ask from their dashboard, and their APIs show up here."
                : `${waiting.length} ${waiting.length === 1 ? "API" : "APIs"} launched and asking to appear in the directory. Agents can already pay for them.`}
            </p>
          </div>
          {waiting.length > 1 && (
            <form id={BULK_FORM} action={approveGateways} className="flex items-center gap-3 text-sm">
              <SelectAll form={BULK_FORM} />
              <button className="btn-brand px-3 py-1.5">List selected</button>
            </form>
          )}
        </div>

        <ul className="mt-4 space-y-4">
          {waiting.map((g, i) => {
            const owner = byOwner.get(g.owner);
            const calls = byApi.get(g.id);
            return (
              <li key={g.id} className="rounded-lg border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="font-medium">
                    {g.name} <span className="font-mono text-sm font-normal text-faint">/x/{g.slug}</span>
                  </h3>
                  {waiting.length > 1 && (
                    <label className="flex items-center gap-2 text-sm text-muted">
                      <input type="checkbox" name="ids" value={g.id} form={BULK_FORM} />
                      Select
                    </label>
                  )}
                </div>
                {g.description ? <p className="mt-1 text-sm text-muted">{g.description}</p> : <p className="mt-1 text-sm text-warn">No description, so agents can&apos;t tell what it does.</p>}

                <dl className="mt-3 grid gap-1 text-xs text-muted">
                  <Fact label="API address">{g.upstreamUrl}</Fact>
                  <Fact label="Price">
                    {[g.acceptUsdg ? `$${Number(g.priceUsd)} USDG` : null, g.autonomoAmount ? `${g.autonomoAmount} $AUTONOMO` : null].filter(Boolean).join(" or ")} a call
                  </Fact>
                  <Fact label="Creator">{g.owner}</Fact>
                  <Fact label="Gets paid at">{g.payTo ? `${payeeOf(g)} (a separate payout wallet)` : "the creator's sign-in wallet"}</Fact>
                  <Fact label="Creator has">
                    {owner?.apis ?? 1} {owner?.apis === 1 ? "API" : "APIs"}, {owner?.listed ?? 0} already listed
                  </Fact>
                  <Fact label="Paid calls">{calls ? `${calls.calls} so far, ${calls.settled} settled` : "none yet"}</Fact>
                  <Fact label="Asked">{when(g.updatedAt)}</Fact>
                </dl>

                {g.status === "paused" && <p className="mt-3 text-sm text-warn">This API is paused, so it takes no payments right now.</p>}

                <div className="mt-3 rounded-md border border-line bg-bg p-3 text-sm">
                  <p className="font-mono text-xs tracking-wide text-faint uppercase">Checked just now</p>
                  {i < CHECKED ? (
                    <Suspense fallback={<p className="mt-1 text-muted">Checking…</p>}>
                      <LiveChecks g={g} origin={origin} />
                    </Suspense>
                  ) : (
                    <p className="mt-1 text-muted">Not checked: only the first {CHECKED} in the queue are. Reload after clearing some.</p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <form action={approveGateway}>
                    <input type="hidden" name="id" value={g.id} />
                    <button className="btn-brand px-3 py-1.5 text-sm">List it</button>
                  </form>
                  <form action={rejectGateway} className="flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={g.id} />
                    <input name="note" maxLength={300} placeholder="Reason (shown to the creator)" aria-label={`Reason for rejecting ${g.name}`} className="field w-64 py-1.5" />
                    <button className="rounded-md border border-line px-3 py-1.5 text-sm">Reject</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="submissions" className="mt-12 scroll-mt-6">
        <h2 className="text-lg font-semibold">Directory submissions</h2>
        <p className="mt-1 text-sm text-muted">
          {pending.length === 0
            ? "None. These come from the listing form, for projects that take x402 payments on their own."
            : `${pending.length} ${pending.length === 1 ? "project" : "projects"} sent through the listing form. Their payments never touch Autonomo.`}
        </p>
        <ul className="mt-4 space-y-4">
          {pending.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">
                  {s.name} <span className="text-sm font-normal text-faint">· {CATEGORY_INFO[s.category]?.label}</span>
                </h3>
                <time className="text-xs text-faint">{when(s.createdAt)}</time>
              </div>
              {s.reviewNote && <p className="mt-1 text-sm text-warn">{s.reviewNote}</p>}
              <p className="mt-2 text-sm text-muted">{s.description}</p>
              <dl className="mt-3 grid gap-1 text-xs text-muted">
                {(
                  [
                    ["Website", s.website],
                    ["GitHub", s.github],
                    ["X", s.twitter],
                    ["Paid address", s.endpointUrl],
                    ["Contact", s.contact],
                  ] as const
                )
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <Fact key={k} label={k}>
                      {v}
                    </Fact>
                  ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={approveSubmission}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn-brand px-3 py-1.5 text-sm">Approve and publish</button>
                </form>
                <form action={rejectSubmission} className="flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <input name="note" maxLength={300} placeholder="Reason (optional)" aria-label={`Reason for rejecting ${s.name}`} className="field w-56 py-1.5" />
                  <button className="rounded-md border border-line px-3 py-1.5 text-sm">Reject</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Two live checks on one waiting API: does the creator's API answer, and does the paid address ask for payment. */
async function LiveChecks({ g, origin }: { g: Gateway; origin: string }) {
  const [upstream, paid] = await Promise.all([
    testGateway(g).then(testVerdict, () => ({ pass: false, text: "The check itself failed. Reload to try again." })),
    paidAddressCheck(`${origin}/x/${g.slug}`),
  ]);
  return (
    <ul className="mt-1 grid gap-1">
      <li className={upstream.pass ? "text-accent" : "text-warn"}>
        <span className="font-medium">Their API:</span> {upstream.text}
        {upstream.pass && g.upstreamAuthHeader ? " Sent with the saved key." : ""}
      </li>
      <li className={paid.pass ? "text-accent" : "text-warn"}>
        <span className="font-medium">Paid address:</span> {paid.text}
      </li>
    </ul>
  );
}

/** One unpaid call to the paid address, as an agent's first request: a working one answers 402 with its price. */
async function paidAddressCheck(url: string): Promise<{ pass: boolean; text: string }> {
  try {
    const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    await res.body?.cancel();
    if (res.status === 402) {
      return res.headers.get("payment-required")
        ? { pass: true, text: "Asks for payment and states its price, as it should." }
        : { pass: false, text: "Answers 402 but doesn't state a price." };
    }
    if (res.status === 503) return { pass: false, text: "Answers 503: payments aren't switched on, or the API is paused." };
    return { pass: false, text: `Answers ${res.status} instead of asking for payment.` };
  } catch {
    return { pass: false, text: "Didn't answer within 8 seconds." };
  }
}
