import "server-only";
import { after, NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { eq, isNotNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Gateway } from "@/db/schema";
import { baseStatus } from "@/lib/payments/base-pay";
import { bondContract, bondEnabled, readBondState, readWalletBonds } from "@/lib/trust/bond";
import { SLASH_INTERVAL_S } from "@/lib/trust/bond-rules";
import { BURN_BPS, noteBaseBurnCall, noteBurnCall, payToFor } from "@/lib/payments/burn";
import { checkUpstream, forward, gatewayOffers, payeeOf, recordCall } from "@/lib/gateway/gateway";
import { acceptsFor, railForAsset, USDC_BASE, x402Server } from "@/lib/payments/payments";
import {
  cachedBond, createRouter, eligible, parseRetryAfter, probeInputFor, probesDue, recordProbe, recordSlashes, refreshStats, statsFor, uptimeDue,
  STILL_NOT_READY,
  type Router, type Stats,
} from "@/lib/router/router";
import { formatTest, probeApi, toRoutableApi, type FormatTest, type RouteSettings } from "@/lib/router/router-apis";
import type { Routable, RouteDeps } from "@/lib/router/router-http";
import { pruneRouterRecord, routerStore } from "@/lib/router/router-store";
import { OFFICIAL_OWNER } from "@/lib/directory/track-record";

// The router's side of the gateway: the real versions of what router-http.ts takes as functions. A routed call is
// paid the same way as a direct call to /x/<slug>: same payment options, same pay-to (the creator's splitter, so the
// 5% burn applies), same wrapper, same log. Gloam cash-outs are not offered on routed calls: that money lands before
// the call, so a failed call couldn't simply be left unsettled.
//
// Env:
//   ROUTER_ENABLED   "1" switches /route on. Without it the route answers 404.

export const routerEnabled = () => process.env.ROUTER_ENABLED?.trim() === "1";

// ---------- the routable APIs ----------

const ROUTABLE_TTL_MS = 30_000;
let routables: { rows: Routable<Gateway>[]; until: number } | undefined;

/** Every API that serves a capability, read from the database and kept for 30 seconds, like gateway rows. */
export async function routableGateways(): Promise<Routable<Gateway>[]> {
  if (routables && routables.until > Date.now()) return routables.rows;
  const db = await getDb();
  const { gateways } = schema;
  const found = await db.select().from(gateways).where(or(isNotNull(gateways.routeCapability), eq(gateways.owner, OFFICIAL_OWNER)));
  const rows = found.flatMap((g) => {
    const r = toRoutableApi(g);
    return r ? [{ ...r, gateway: g }] : [];
  });
  routables = { rows, until: Date.now() + ROUTABLE_TTL_MS };
  return rows;
}

// Tier 1 follows the site's Bonded rule (src/lib/trust/bond.ts), the one the badge shows, not the contract's own floor.
const isBonded = cachedBond(async (wallet) => (bondEnabled() ? (await readWalletBonds([wallet]))[wallet]?.bonded === true : false));

let router: Promise<Router> | undefined;

function getRouter() {
  router ??= getDb()
    .then((db) => createRouter({ store: routerStore(db), apis: async () => (await routableGateways()).map((r) => r.api), isBonded }))
    .catch((e) => {
      router = undefined;
      throw e;
    });
  return router;
}

// ---------- the payment wrapper ----------

// The handler a wrapper runs is the same for every request, so each request's own work is looked up by the request.
const work = new WeakMap<Request, () => Promise<Response>>();
const wrappers = new Map<string, (req: NextRequest) => Promise<NextResponse>>();

/** Where a gateway is paid right now: its splitter on Robinhood Chain, and on Base when Base can be offered. */
async function payTos(g: Gateway) {
  const [payTo, base] = await Promise.all([payToFor(payeeOf(g)), baseStatus(g)]);
  return { payTo, basePayTo: base.payTo };
}

/** One paid wrapper per gateway version, as for direct calls, so price and wallet changes take effect at once. */
async function wrapperFor(g: Gateway) {
  const { payTo, basePayTo } = await payTos(g);
  const key = `${g.id}:${g.updatedAt.getTime()}:${payTo}:${basePayTo}`;
  let fn = wrappers.get(key);
  if (!fn) {
    fn = withX402(
      async (req: NextRequest) => {
        const run = work.get(req);
        if (!run) return NextResponse.json({ error: "nothing_to_run" }, { status: 500 });
        const res = await run();
        return new NextResponse(res.body, { status: res.status, headers: res.headers });
      },
      { accepts: acceptsFor(payTo, gatewayOffers(g, basePayTo)), description: g.description || g.name, mimeType: "application/json" },
      x402Server()!,
    );
    if (wrappers.size > 500) wrappers.clear();
    wrappers.set(key, fn);
  }
  return fn;
}

const PAYMENT_HEADERS = ["payment-signature", "x-payment"];

/** The same request without its payment, which the wrapper answers with the gateway's 402. */
function unpaid(request: Request) {
  const headers = new Headers(request.headers);
  for (const h of PAYMENT_HEADERS) headers.delete(h);
  return new NextRequest(request.url, { method: "GET", headers });
}

/**
 * Calls the API behind a gateway the way a paid call is sent: same address rules, same key, same limits. Routed
 * calls and probes both go through here and nowhere else, so the API gets the same request for either: this one
 * header and its own key. Nothing of the agent's request is passed on (no payment, no route id, no user agent), and
 * nothing marks a probe. Keep it that way: an API that could tell a probe apart could answer probes well and paid
 * calls badly.
 */
async function callGateway(g: Gateway, path: string) {
  const target = new URL(path, "https://router.invalid");
  const started = Date.now();
  const res = await forward(g, new Request(target, { headers: { accept: "application/json" } }), target.pathname);
  const ms = Date.now() - started;
  let body: unknown = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  return { status: res.status, body, ms, retryAfter: parseRetryAfter(res.headers.get("retry-after")) };
}

function decodeHeader(value: string | null): Record<string, any> | null {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Logs a routed call that carried a payment, the way the gateway route logs a direct one (gateway_calls), so the
 * creator's revenue, the burn and the track record count it too.
 */
function logPaidCall(g: Gateway, request: Request, res: Response, startedAt: number, path: string) {
  const payment = decodeHeader(request.headers.get("payment-signature"));
  if (!payment) return;
  const settlement = decodeHeader(res.headers.get("payment-response"));
  const accepted = payment.accepted ?? {};
  const auth = payment.payload?.authorization ?? payment.payload?.permit2Authorization ?? {};
  const settled = settlement?.success === true;
  const rail = railForAsset(accepted.asset, accepted.network);
  const status = res.status;
  const latencyMs = Date.now() - startedAt;
  after(async () => {
    const { payTo, basePayTo } = await payTos(g);
    // What the payee keeps: 5% less when the payment went to a splitter, on either chain.
    const burnBps = (rail === "usdc_base" ? basePayTo !== payeeOf(g) : payTo !== payeeOf(g)) ? BURN_BPS : 0;
    await recordCall({
      gatewayId: g.id,
      method: request.method,
      path: path.slice(0, 300),
      status,
      latencyMs,
      rail,
      asset: typeof accepted.asset === "string" ? accepted.asset : null,
      amount: typeof accepted.amount === "string" ? accepted.amount : null,
      burnBps,
      payer: (settlement?.payer ?? auth.from ?? null)?.toString().toLowerCase() ?? null,
      settled,
      tx: typeof settlement?.transaction === "string" ? settlement.transaction : null,
    }).catch((e) => console.error("routed call log failed", e));
    if (settled && burnBps > 0) {
      const note = rail === "usdc_base" ? noteBaseBurnCall : noteBurnCall;
      await note(payeeOf(g)).catch((e) => console.error("burn flush failed", e));
    }
  });
}

/** Everything /route needs, wired to the real gateway. */
export async function routeDeps(): Promise<RouteDeps<Gateway>> {
  return {
    router: await getRouter(),
    now: () => Date.now(),
    load: routableGateways,
    required: async (g, request) => (await wrapperFor(g))(unpaid(request)),
    paid: async (g, request, inner) => {
      work.set(request, inner);
      return (await wrapperFor(g))(request as NextRequest);
    },
    paysFor: async (g, accepted) => {
      const to = typeof accepted.payTo === "string" ? accepted.payTo.toLowerCase() : "";
      if (!to) return false;
      const { payTo, basePayTo } = await payTos(g);
      return accepted.network === USDC_BASE.network ? to === basePayTo?.toLowerCase() : to === payTo.toLowerCase();
    },
    call: callGateway,
    onPaid: logPaidCall,
  };
}

// ---------- enabling an API ----------

const forgetRoutables = () => {
  routables = undefined;
};

async function gatewayById(id: number) {
  const db = await getDb();
  const [g] = await db.select().from(schema.gateways).where(eq(schema.gateways.id, id)).limit(1);
  return g ?? null;
}

/**
 * Runs the format test on one API, with a real call sent the way a routed call would be. If it passes, the API
 * becomes routable: its days of ten probes a day start, and it is eligible once it has 20 measured calls. A test
 * that fails changes nothing: an API that was routable stays so, and its probes decide.
 */
export async function testAndEnable(id: number): Promise<{ slug: string; test: FormatTest } | null> {
  const g = await gatewayById(id);
  if (!g) return null;
  const r = toRoutableApi(g);
  if (!r) return { slug: g.slug, test: { ok: false, reason: "no capability and path are set for this API", status: null, ms: null } };
  const test = await formatTest(r.settings, (path) => callGateway(g, path));
  if (test.ok && !g.routeFormatOk) {
    const db = await getDb();
    await db.update(schema.gateways).set({ routeFormatOk: true, routeListedAt: new Date() }).where(eq(schema.gateways.id, id));
    forgetRoutables();
  }
  return { slug: g.slug, test };
}

/** Takes an API out of routing. It stays callable by name. */
export async function stopRouting(id: number) {
  const db = await getDb();
  const changed = await db.update(schema.gateways).set({ routeFormatOk: false }).where(eq(schema.gateways.id, id)).returning({ slug: schema.gateways.slug });
  forgetRoutables();
  return changed[0]?.slug ?? null;
}

/** Saves an API's routing settings, or clears them with null. Either way it has to pass the format test again. */
export async function saveRouteSettings(id: number, settings: RouteSettings | null) {
  const db = await getDb();
  const changed = await db
    .update(schema.gateways)
    .set({
      routeCapability: settings?.capability ?? null,
      routePath: settings?.path ?? null,
      routeMapping: settings?.mapping ?? null,
      routeFormatOk: false,
      routeListedAt: null,
    })
    .where(eq(schema.gateways.id, id))
    .returning({ slug: schema.gateways.slug });
  forgetRoutables();
  return changed[0]?.slug ?? null;
}

export type RouterRow = Routable<Gateway> & { stats: Stats; eligible: boolean };

/** Every API that serves a capability, with its record, for the admin page. Read fresh. */
export async function routerOverview(): Promise<RouterRow[]> {
  forgetRoutables();
  const [r, all] = await Promise.all([getRouter(), routableGateways()]);
  const now = Date.now();
  return Promise.all(
    all.map(async (row) => {
      const stats = await statsFor(r.store, row.api, now);
      return { ...row, stats, eligible: eligible(row.api, stats, now) };
    }),
  );
}

// ---------- probes ----------

const UPTIME_TIMEOUT_MS = 5000;

/**
 * The uptime probe: a light request straight to the API's own server, not through the gateway, which always
 * answers 402. Any answer under 500 within 5 seconds counts as up.
 */
async function checkUp(g: Gateway): Promise<boolean> {
  const check = await checkUpstream(g.upstreamUrl);
  if (!check.ok) return false;
  try {
    const res = await fetch(check.url, {
      method: "HEAD",
      headers: { "user-agent": "autonomo-uptime/1" },
      redirect: "manual",
      signal: AbortSignal.timeout(UPTIME_TIMEOUT_MS),
      cache: "no-store",
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Runs `job` over the items, a few at a time, starting no new one after the deadline. Returns how many ran. */
async function pooled<T>(items: T[], size: number, deadline: number, job: (item: T) => Promise<void>) {
  let next = 0;
  let ran = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length && Date.now() < deadline) {
        const item = items[next++];
        ran += 1;
        await job(item).catch((e) => console.error("router job failed", e));
      }
    }),
  );
  return ran;
}

/**
 * Reads from the bond contract when each routable API's wallet was last slashed, and puts new slashes on the router's
 * record. The contract keeps one date per wallet: the earliest a next slash may be opened, 30 days after the last one
 * ran. So the last slash is that date less 30 days, with no search through the chain's history.
 */
async function syncSlashes(r: Router, wallets: string[]) {
  const bond = bondContract();
  if (!bond) return [];
  const executed: { provider: string; at: number }[] = [];
  await Promise.all(
    [...new Set(wallets)].map(async (wallet) => {
      const { nextSlashAt } = await readBondState(bond, wallet);
      if (nextSlashAt > 0) executed.push({ provider: wallet, at: (nextSlashAt - SLASH_INTERVAL_S) * 1000 });
    }),
  );
  return recordSlashes(r.store, executed);
}

export type RouterJobs = {
  /** Wallets whose slash on the bond contract was put on the record on this run: their APIs leave routing for 30 days. */
  slashed: string[];
  uptime: { checked: number; down: string[] };
  /**
   * `waiting`: APIs that said "not ready yet" and will be asked once more on a later run. `real`: how many probes
   * used an input an agent paid for instead of the fixed one. `noAnswer`: APIs that had no answer for such an input
   * and had never answered it, which is kept but not counted.
   */
  probes: { run: number; real: number; failed: { slug: string; reason: string }[]; waiting: string[]; noAnswer: string[]; left: number };
  /** How many APIs had their saved stats worked out again. */
  refreshed: number;
  ms: number;
};

/**
 * The router's regular work: new slashes from the bond contract, the uptime probes that are due, the probes that are
 * due, a refresh of every API's saved stats, and a tidy-up. Safe to run as
 * often as wanted, since each API is only probed when its own time has come. What doesn't fit in `budgetMs` is left
 * for the next run.
 *
 * A probe calls the API the way a routed call does, through the gateway's own forwarding, and is not paid: the API
 * can't tell it from a paid call, since it never sees the payer. Its input is one an agent paid for on that service
 * when there is one, so the API can't know the input either; otherwise the fixed input for its capability.
 */
export async function runRouterJobs(budgetMs = 45_000): Promise<RouterJobs> {
  const started = Date.now();
  const deadline = started + budgetMs;
  forgetRoutables();
  const [r, all] = await Promise.all([getRouter(), routableGateways()]);
  const bySlug = new Map(all.map((row) => [row.api.slug, row]));

  // First, so a slashed wallet's APIs are out before this run probes them or refreshes their stats. If the chain
  // can't be read, the run goes on and the next one tries again.
  const slashed = await syncSlashes(r, all.map((row) => row.api.payTo)).catch((e) => {
    console.error("router slash sync failed", e);
    return [] as string[];
  });

  const uptime: RouterJobs["uptime"] = { checked: 0, down: [] };
  await pooled(await uptimeDue(r, started), 8, deadline, async (api) => {
    const row = bySlug.get(api.slug);
    if (!row) return;
    const up = await checkUp(row.gateway);
    await r.store.recordUptime(api.slug, up, Date.now());
    uptime.checked += 1;
    if (!up) uptime.down.push(api.slug);
  });

  const failed: RouterJobs["probes"]["failed"] = [];
  const waiting: string[] = [];
  const noAnswer: string[] = [];
  let real = 0;
  const due = await probesDue(r, started);
  const run = await pooled(due, 4, deadline, async (api) => {
    const row = bySlug.get(api.slug);
    if (!row) return;
    const probe = await probeApi(row.settings, (path) => callGateway(row.gateway, path), await probeInputFor(r, api, Date.now()));
    if (probe.real) real += 1;
    // An API that says "not ready yet" is asked once more on a later run, and only that second answer counts.
    const recorded = await recordProbe(r, api.slug, probe, Date.now());
    if (recorded.waiting) waiting.push(api.slug);
    else if (!recorded.counted) noAnswer.push(api.slug);
    else if (!probe.valid) failed.push({ slug: api.slug, reason: probe.notReady ? STILL_NOT_READY : probe.reason });
  });

  // Every API's saved stats are worked out again, so requests between two runs find a fresh copy and only read it.
  const refreshed = await pooled(all, 8, deadline, async (row) => void (await refreshStats(r.store, row.api, Date.now())));

  await pruneRouterRecord(await getDb(), started).catch((e) => console.error("router tidy-up failed", e));
  return { slashed, uptime, probes: { run, real, failed, waiting, noAnswer, left: due.length - run }, refreshed, ms: Date.now() - started };
}
