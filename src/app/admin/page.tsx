import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getDb, schema } from "@/db";
import { CATEGORY_INFO } from "@/lib/categories";
import { approveGateway, approveSubmission, rejectGateway, rejectSubmission, setProjectFlags } from "./actions";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage() {
  await connection();
  const db = await getDb();
  const [pending, recent, gatewayRequests] = await Promise.all([
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
