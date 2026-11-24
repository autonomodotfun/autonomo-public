import { CAPABILITIES, ROUTER } from "@/lib/router/router";
import { OFFICIAL_ROUTES } from "@/lib/router/router-apis";
import { routerEnabled, routerOverview, type RouterRow } from "@/lib/router/router-gateway";
import { runRouterJobsNow, saveRouting, stopRoutingApi, testRouting } from "./actions";

/**
 * The Router tab: which APIs can be routed, what record each has, and the buttons that test one, switch it on or
 * take it out. An API is routed once it has passed the format test and has 20 measured calls with 95% valid answers.
 */
export async function RouterTab({ message }: { message?: string }) {
  let rows: RouterRow[] | null = null;
  try {
    rows = await routerOverview();
  } catch (e) {
    console.error("router overview failed", e);
  }
  const on = routerEnabled();

  return (
    <>
      <section>
        <h2 className="text-lg font-semibold">Router</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          An agent asks <code>/route/&lt;capability&gt;</code> for a service and Autonomo picks the API. An API is picked once it
          has passed the format test and has {ROUTER.measuredWindow} measured calls with {ROUTER.minAnswerRate * 100}% valid
          answers. Probes build that record: three a day at first, then one a day.
        </p>
        <p className={`mt-3 rounded-lg border p-3 text-sm ${on ? "border-line" : "border-warn"}`}>
          {on ? (
            <>
              The router is <span className="font-medium text-accent">on</span>: <code>/route</code> answers and the probes run.
            </>
          ) : (
            <>
              The router is <span className="font-medium text-warn">off</span>: <code>/route</code> answers 404 and the scheduled
              probes are skipped. It is switched on with <code>ROUTER_ENABLED=1</code>. Testing and probing from this page
              work either way, so APIs can build their record first.
            </>
          )}
        </p>
        {message && <p className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">{message}</p>}

        {rows === null ? (
          <p className="mt-6 rounded-lg border border-warn p-4 text-sm">
            <span className="font-medium text-warn">The router&apos;s tables can&apos;t be read.</span> Run the database update (
            <code>npm run db:migrate</code>) against this database once.
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-line p-6 text-sm text-muted">No API serves a capability yet. Set one up below.</p>
        ) : (
          <>
            <form action={runRouterJobsNow} className="mt-4">
              <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface">Run the probes that are due now</button>
            </form>
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
              {rows.map((row) => (
                <ApiRow key={row.gateway.id} row={row} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section id="routing-settings" className="mt-12">
        <h2 className="text-lg font-semibold">Set how an API is routed</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          For an API that isn&apos;t in the list above yet. The path is what comes after <code>/x/&lt;slug&gt;</code>, with the
          capability&apos;s inputs in braces. The mapping says where each standard field is in the API&apos;s own answer; leave it
          empty if the API already uses the standard names. Saving takes the API out of routing until it passes the test again.
        </p>
        <form action={saveRouting} className="mt-3 grid max-w-2xl gap-3 text-sm">
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1">
              API slug
              <input name="slug" required className="field w-56" placeholder="e.g. token-lookup" />
            </label>
            <label className="grid gap-1">
              Capability
              <select name="capability" className="field w-48" defaultValue="">
                <option value="">None (not routed)</option>
                {Object.keys(CAPABILITIES).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-1">
            Path
            <input name="path" className="field font-mono" placeholder="/price/{token}?chain={chain}" />
          </label>
          <label className="grid gap-1">
            Mapping (JSON, optional)
            <textarea name="mapping" rows={3} className="field font-mono" placeholder={'{"price_usd": "priceUsd", "as_of": "updatedAt"}'} />
          </label>
          <div>
            <button className="btn-brand px-3 py-2">Save</button>
          </div>
        </form>
        <details className="mt-4 max-w-2xl text-sm">
          <summary className="cursor-pointer text-muted">Fields each capability must answer with</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
            {Object.entries(CAPABILITIES).map(([name, fields]) => (
              <li key={name}>
                <span className="text-ink">{name}</span>: {Object.keys(fields).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </>
  );
}

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

function ApiRow({ row }: { row: RouterRow }) {
  const { gateway: g, api, settings, stats, eligible } = row;
  const preset = g.routeCapability === null && g.slug in OFFICIAL_ROUTES;
  const state = eligible
    ? { tone: "ok" as const, text: "Routed" }
    : !api.formatOk
      ? { tone: "muted" as const, text: "Not tested yet" }
      : !api.launched || api.unlisted
        ? { tone: "warn" as const, text: api.launched ? "Not listed, so not routed" : "Paused, so not routed" }
        : stats.measured < ROUTER.measuredWindow
          ? { tone: "muted" as const, text: `Building its record: ${stats.measured} of ${ROUTER.measuredWindow} calls` }
          : { tone: "warn" as const, text: "Off its record" };
  const color = state.tone === "ok" ? "border-accent text-accent" : state.tone === "warn" ? "border-warn text-warn" : "border-line text-faint";

  return (
    <li className="p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium">
          {g.name} <span className="font-mono text-xs font-normal text-faint">/x/{g.slug}</span>
        </p>
        <p className="flex flex-wrap gap-1.5 text-xs">
          <span className={`rounded-full border px-2 py-0.5 ${color}`}>{state.text}</span>
          {api.official && <span className="rounded-full border border-line px-2 py-0.5 text-faint">Official: never tier 1</span>}
        </p>
      </div>
      <p className="mt-1 font-mono text-xs break-all text-muted">
        {settings.capability} · {settings.path} · ${api.priceUsd} a call{preset ? " · settings from the built-in list" : ""}
      </p>
      <p className="mt-1 text-xs text-muted">
        {stats.measured === 0
          ? "No measured calls yet"
          : `${stats.valid} of the last ${stats.measured} measured calls valid (${percent(stats.answerRate)})${stats.medianMs === null ? "" : `, median ${Math.round(stats.medianMs)} ms`}`}
        {` · uptime ${percent(stats.uptime)} over 7 days`}
        {stats.lastSlash ? ` · slashed ${new Date(stats.lastSlash).toISOString().slice(0, 10)}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={testRouting}>
          <input type="hidden" name="id" value={g.id} />
          <button className="rounded-md border border-line px-2.5 py-1 hover:bg-surface">{api.formatOk ? "Run the format test again" : "Run the format test and switch on"}</button>
        </form>
        {api.formatOk && (
          <form action={stopRoutingApi}>
            <input type="hidden" name="id" value={g.id} />
            <button className="rounded-md border border-line px-2.5 py-1 hover:bg-surface">Take out of routing</button>
          </form>
        )}
      </div>
    </li>
  );
}
