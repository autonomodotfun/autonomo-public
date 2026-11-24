// The router's two stores, held to the same tests: the in-memory one and the database one. The database here is a
// real Postgres running in memory (PGlite) with every migration applied, so the SQL is the SQL production runs.
// No network. Run: npx tsx --test src/lib/router/router-store.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, type DB } from "@/db";
import {
  ROUTER, cachedBond, createRouter, eligible, memoryStore, recordMeasured, recordSlashes, routePaidCall, startRoute, statsFor,
  type MeasuredCall, type RoutableApi, type RouteHooks, type RouterStore, type Stats,
} from "@/lib/router/router";
import { pruneRouterRecord, routerStore } from "@/lib/router/router-store";

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const DAY = 86_400_000;
const CAP = ROUTER.maxCallsPerPayerDay;

let database: Promise<DB> | undefined;
/** One in-memory Postgres for the whole file, migrated the way `npm run db:migrate` does it. */
function testDb() {
  database ??= (async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    return db as unknown as DB;
  })();
  return database;
}

const stores: [string, () => Promise<RouterStore>][] = [
  ["memory", async () => memoryStore()],
  ["database", async () => routerStore(await testDb())],
];

// Every test uses its own slugs and wallets, so they can share the one database.
let n = 0;
const fresh = (name: string) => `${name}-${++n}`;

const call = (slug: string, at: number, over: Partial<MeasuredCall> = {}): MeasuredCall => ({
  slug, at, valid: true, ms: 500, kind: "probe", payer: "", settled: false, reason: "", counted: true, ...over,
});
const failed = (slug: string, at: number, payer: string) => call(slug, at, { valid: false, kind: "routed", payer, reason: "status 500" });

for (const [name, open] of stores) {
  test(`${name}: counted calls come back newest first, inside the window and the limit`, async () => {
    const store = await open();
    const slug = fresh("api");
    for (let i = 0; i < 25; i++) await store.recordCall(call(slug, NOW - i * SECOND, { ms: i }));
    await store.recordCall(call(slug, NOW - 40 * DAY));
    await store.recordCall(call(fresh("other"), NOW));
    const rows = await store.countedCalls(slug, NOW - 30 * DAY, 20, CAP);
    assert.equal(rows.length, 20);
    assert.deepEqual(rows.map((r) => r.ms), Array.from({ length: 20 }, (_, i) => i));
    assert.deepEqual(rows[0], call(slug, NOW, { ms: 0 }), "a row comes back as it was saved");
    assert.equal((await store.countedCalls(slug, NOW - 50 * DAY, 100, CAP)).length, 26);
  });

  test(`${name}: a "no answer" call is kept but not counted`, async () => {
    const store = await open();
    const slug = fresh("api");
    await store.recordCall(call(slug, NOW));
    await store.recordCall(call(slug, NOW + 1, { valid: false, kind: "routed", payer: "0xp", counted: false, reason: "status 404" }));
    assert.equal((await store.countedCalls(slug, NOW - DAY, 20, CAP)).length, 1);
  });

  test(`${name}: one payer's routed calls count up to the cap per day, good or bad`, async () => {
    const store = await open();
    const slug = fresh("api");
    const read = async (cap: number) => (await store.countedCalls(slug, NOW - DAY, 100, cap)).filter((r) => !r.valid);
    const day0 = Math.floor(NOW / DAY) * DAY + 3_600_000; // an hour into a UTC day
    for (let i = 0; i < 50; i++) await store.recordCall(failed(slug, day0 + i, "0xgriefer"));
    assert.equal((await read(1)).length, 1);
    assert.equal((await read(1))[0].at, day0, "the first of the day is the one that counts");
    assert.equal((await read(3)).length, 3);
    for (let i = 0; i < 3; i++) await store.recordCall(failed(slug, day0 + 100 + i, `0xother${i}`));
    assert.equal((await read(1)).length, 4, "other payers' failures still count");
    for (let i = 0; i < 5; i++) await store.recordCall(failed(slug, day0 + DAY + i, "0xgriefer"));
    assert.equal((await read(1)).length, 5, "the same payer counts again the next day");
    // The same cap holds for good calls. That payer already counted today; a new payer counts once, with its first.
    for (let i = 0; i < 4; i++) await store.recordCall(call(slug, day0 + 200 + i, { kind: "routed", payer: "0xgriefer", settled: true }));
    for (let i = 0; i < 4; i++) await store.recordCall(call(slug, day0 + 250 + i, { kind: "routed", payer: "0xfan", settled: true }));
    // What is never capped: probes.
    for (let i = 0; i < 4; i++) await store.recordCall(call(slug, day0 + 300 + i, { valid: false }));
    const all = await store.countedCalls(slug, NOW - DAY, 100, 1);
    assert.deepEqual(all.filter((r) => r.valid).map((r) => [r.payer, r.at]), [["0xfan", day0 + 250]]);
    assert.equal(all.filter((r) => !r.valid && r.kind === "probe").length, 4);
    assert.equal((await store.countedCalls(slug, NOW - DAY, 100, 3)).filter((r) => r.valid).length, 3, "a higher cap lets more of the new payer's in");
  });

  test(`${name}: good and bad calls sent at the same moment by one payer are capped together`, async () => {
    const store = await open();
    const slug = fresh("api");
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => store.recordCall(i % 2 ? failed(slug, NOW, "0xbusy") : call(slug, NOW, { kind: "routed", payer: "0xbusy", settled: true }))),
    );
    assert.equal((await store.countedCalls(slug, NOW - DAY, 100, 1)).length, 1);
  });

  test(`${name}: probe inputs are kept once per API, and the pool takes at most three from one payer`, async () => {
    const store = await open();
    // The pool is per capability, so each test has its own.
    const cap = fresh("cap");
    const save = (token: string, payer: string, at: number, slug = "a") => store.saveProbeInput({ capability: cap, inputs: { token }, slug, payer, at });
    const pool = async (limit = 50) => (await store.probeInputs(cap, NOW - 30 * DAY, limit, 3)).map((i) => i.token);
    assert.deepEqual(await pool(), []);
    for (let i = 0; i < 10; i++) await save(`0x${i}`, "0xFlood", NOW + i);
    await save("0xreal", "0xagent", NOW - 3600 * SECOND);
    await save("0xreal", "0xagent2", NOW - 7200 * SECOND, "b"); // the same input, answered by another API
    await save("0xold", "0xagent", NOW - 40 * DAY);
    await save("0xprobe", "", NOW + 20); // an answer to a probe adds nothing to the pool
    assert.deepEqual(await pool(), ["0x9", "0x8", "0x7", "0xreal"], "newest first, three from the flooding payer, each input once");
    assert.deepEqual(await pool(2), ["0x9", "0x8"]);
    assert.deepEqual(await store.probeInputs(fresh("cap"), 0, 50, 3), [], "another service has its own pool");

    assert.equal(await store.answeredBefore(cap, { token: "0xreal" }, "a"), true);
    assert.equal(await store.answeredBefore(cap, { token: "0xreal" }, "b"), true);
    assert.equal(await store.answeredBefore(cap, { token: "0xreal" }, "c"), false);
    assert.equal(await store.answeredBefore(cap, { token: "0xprobe" }, "a"), true, "what an API answered to a probe is remembered");
    assert.equal(await store.answeredBefore(fresh("cap"), { token: "0xreal" }, "a"), false);
  });

  test(`${name}: the same inputs are one row, whatever their order, with the newest time and the agent's wallet`, async () => {
    const store = await open();
    const cap = fresh("cap");
    const read = () => store.probeInputs(cap, NOW - DAY, 50, 3);
    await store.saveProbeInput({ capability: cap, inputs: { token: "0xabc", chain: "base" }, slug: "a", payer: "0xAgent", at: NOW - 2 * DAY });
    assert.deepEqual(await read(), [], "older than the window");
    await store.saveProbeInput({ capability: cap, inputs: { chain: "base", token: "0xabc" }, slug: "a", payer: "0xagent", at: NOW });
    assert.deepEqual(await read(), [{ token: "0xabc", chain: "base" }]);
    // A probe's answer for the same inputs keeps the agent's wallet, and an older time doesn't move the row back.
    await store.saveProbeInput({ capability: cap, inputs: { token: "0xabc", chain: "base" }, slug: "a", payer: "", at: NOW - 3 * DAY });
    assert.equal((await read()).length, 1);
    await Promise.all(Array.from({ length: 20 }, () => store.saveProbeInput({ capability: cap, inputs: { token: "0xsame" }, slug: "a", payer: "0xother", at: NOW })));
    assert.equal((await read()).length, 2, "saved at the same moment, still one row");
    assert.equal(await store.answeredBefore(cap, { chain: "base", token: "0xabc" }, "a"), true);
    assert.equal(await store.answeredBefore(cap, { token: "0xabc" }, "a"), false, "without the chain it is another input");
  });

  test(`${name}: slashes from the bond contract are recorded once per wallet, and only for that wallet`, async () => {
    const store = await open();
    const [w1, w2] = [fresh("0xw"), fresh("0xw")];
    assert.deepEqual(await recordSlashes(store, [{ provider: w1.toUpperCase().replace("0X", "0x"), at: NOW }, { provider: w1, at: NOW - DAY }]), [w1]);
    assert.equal(await store.lastSlash(fresh("api"), w1), NOW, "the newest of the two");
    assert.equal(await store.lastSlash(fresh("api"), w2), null);
    assert.deepEqual(await recordSlashes(store, [{ provider: w1, at: NOW }]), [], "already on the record");
    assert.deepEqual(await recordSlashes(store, [{ provider: w1, at: NOW + DAY }, { provider: w2, at: NOW }]), [w1, w2]);
    assert.equal(await store.lastSlash(fresh("api"), w2), NOW);
  });

  test(`${name}: failed calls sent at the same moment are still capped`, async () => {
    const store = await open();
    const slug = fresh("api");
    await Promise.all(Array.from({ length: 30 }, () => store.recordCall(failed(slug, NOW, "0xgriefer"))));
    assert.equal((await store.countedCalls(slug, NOW - DAY, 100, 1)).length, 1);
  });

  test(`${name}: paid probes are counted since a time`, async () => {
    const store = await open();
    const slug = fresh("api");
    await store.recordCall(call(slug, NOW - 2 * DAY));
    await store.recordCall(call(slug, NOW - 3600 * SECOND));
    await store.recordCall(call(slug, NOW, { kind: "routed", payer: "0xp" }));
    assert.equal(await store.probesSince(slug, NOW - DAY), 1);
    assert.equal(await store.probesSince(slug, NOW - 3 * DAY), 2);
    assert.equal(await store.probesSince(fresh("none"), 0), 0);
  });

  test(`${name}: the newest probe is found, counted or not`, async () => {
    const store = await open();
    const slug = fresh("api");
    assert.equal(await store.lastProbe(slug), null);
    await store.recordCall(call(slug, NOW - DAY));
    await store.recordCall(call(slug, NOW, { valid: false, counted: false, reason: "not ready yet", ms: 21_000 }));
    await store.recordCall(call(slug, NOW + SECOND, { kind: "routed", payer: "0xp" })); // a routed call is not a probe
    await store.recordCall(call(fresh("other"), NOW + 2 * SECOND));
    assert.deepEqual(await store.lastProbe(slug), call(slug, NOW, { valid: false, counted: false, reason: "not ready yet", ms: 21_000 }));
    // Two at the same time: the one recorded last.
    await store.recordCall(call(slug, NOW, { reason: "second" }));
    assert.equal((await store.lastProbe(slug))?.reason, "second");
  });

  test(`${name}: uptime probes`, async () => {
    const store = await open();
    const slug = fresh("api");
    assert.equal(await store.lastUptime(slug), null);
    assert.deepEqual(await store.uptime(slug, 0), { up: 0, total: 0 });
    for (let i = 0; i < 10; i++) await store.recordUptime(slug, i < 5, NOW - i * 60 * SECOND);
    await store.recordUptime(slug, false, NOW - 8 * DAY);
    assert.deepEqual(await store.uptime(slug, NOW - 7 * DAY), { up: 5, total: 10 });
    assert.equal(await store.lastUptime(slug), NOW);
  });

  test(`${name}: a slash is found by the API or by its wallet, whatever the letter case`, async () => {
    const store = await open();
    const [a, b, c] = [fresh("api"), fresh("api"), fresh("api")];
    const wallet = `0xAbC${fresh("wallet")}`;
    assert.equal(await store.lastSlash(a, wallet), null);
    await store.recordSlash(a, wallet, NOW - 5 * DAY);
    await store.recordSlash(a, wallet, NOW - 2 * DAY);
    assert.equal(await store.lastSlash(a, "0xsomeoneelse"), NOW - 2 * DAY, "by slug");
    assert.equal(await store.lastSlash(b, wallet.toUpperCase().replace("0X", "0x")), NOW - 2 * DAY, "by wallet");
    assert.equal(await store.lastSlash(c, "0xsomeoneelse"), null);
  });

  test(`${name}: a paused payer`, async () => {
    const store = await open();
    const payer = `0xPayer${fresh("p")}`;
    assert.equal(await store.blockedUntil(payer), null);
    await store.blockPayer(payer, NOW + DAY);
    assert.equal(await store.blockedUntil(payer.toLowerCase()), NOW + DAY);
    await store.blockPayer(payer.toLowerCase(), NOW + 2 * DAY);
    assert.equal(await store.blockedUntil(payer), NOW + 2 * DAY, "a second failure moves the date");
  });

  test(`${name}: a route id is used once, before it expires, and comes back whole`, async () => {
    const store = await open();
    const route = { id: fresh("route"), capability: "token-price", inputs: { chain: "base", token: "0xabc" }, slug: "a", tried: [{ slug: "b", noData: true }], expires: NOW + 60 * SECOND };
    await store.saveRoute(route);
    assert.equal(await store.takeRoute(fresh("unknown"), NOW), null);
    assert.deepEqual(await store.takeRoute(route.id, NOW), route);
    assert.equal(await store.takeRoute(route.id, NOW), null, "already used");
    const late = { ...route, id: fresh("route") };
    await store.saveRoute(late);
    assert.equal(await store.takeRoute(late.id, NOW + 60 * SECOND), null, "expired");
  });

  test(`${name}: many requests with the same route id, only one gets it`, async () => {
    const store = await open();
    const route = { id: fresh("route"), capability: "token-price", inputs: {}, slug: "a", tried: [], expires: NOW + 60 * SECOND };
    await store.saveRoute(route);
    const got = await Promise.all(Array.from({ length: 20 }, () => store.takeRoute(route.id, NOW)));
    assert.equal(got.filter(Boolean).length, 1);
  });

  test(`${name}: open routes for a request, newest first, whatever the order of its inputs`, async () => {
    const store = await open();
    const capability = fresh("capability");
    const base = { capability, slug: "a", tried: [], expires: NOW + 60 * SECOND };
    const [older, newer, used, expired, otherInputs] = [fresh("route"), fresh("route"), fresh("route"), fresh("route"), fresh("route")];
    await store.saveRoute({ ...base, id: older, inputs: { chain: "base", token: "0xabc" }, expires: NOW + 30 * SECOND });
    await store.saveRoute({ ...base, id: newer, inputs: { token: "0xabc", chain: "base" }, slug: "b" });
    await store.saveRoute({ ...base, id: used, inputs: { token: "0xabc", chain: "base" } });
    await store.takeRoute(used, NOW);
    await store.saveRoute({ ...base, id: expired, inputs: { token: "0xabc", chain: "base" }, expires: NOW - SECOND });
    await store.saveRoute({ ...base, id: otherInputs, inputs: { token: "0xabc" } });
    const found = await store.openRoutes(capability, { token: "0xabc", chain: "base" }, NOW);
    assert.deepEqual(found.map((r) => r.id), [newer, older]);
    assert.deepEqual(found[0], { ...base, id: newer, inputs: { token: "0xabc", chain: "base" }, slug: "b" });
    assert.deepEqual(await store.openRoutes(fresh("capability"), { token: "0xabc", chain: "base" }, NOW), []);
  });

  test(`${name}: requests are counted per caller and minute, also when they arrive together`, async () => {
    const store = await open();
    const [a, b] = [fresh("ip:1.2.3."), fresh("payer:0x")];
    const minute = Math.floor(NOW / 60_000) * 60_000;
    assert.equal(await store.countHit(a, minute), 1);
    assert.equal(await store.countHit(a, minute), 2);
    assert.equal(await store.countHit(b, minute), 1, "another caller has its own count");
    assert.equal(await store.countHit(a, minute + 60_000), 1, "a new minute starts again");
    const counts = await Promise.all(Array.from({ length: 25 }, () => store.countHit(b, minute)));
    assert.deepEqual([...counts].sort((x, y) => x - y), Array.from({ length: 25 }, (_, i) => i + 2));
  });

  test(`${name}: saved stats come back as saved, the newest copy wins, and old copies are left out`, async () => {
    const store = await open();
    const [a, b] = [{ slug: fresh("api"), payTo: `0x${fresh("W")}` }, { slug: fresh("api"), payTo: `0x${fresh("W")}` }];
    const stats: Stats = { measured: 20, valid: 19, answerRate: 19 / 20, medianMs: 412.5, uptime: 95 / 96, lastSlash: NOW - 40 * DAY };
    const empty: Stats = { measured: 0, valid: 0, answerRate: 0, medianMs: null, uptime: 1, lastSlash: null };
    await store.saveStats(a, stats, NOW);
    await store.saveStats(b, empty, NOW - 20 * 60 * SECOND);
    assert.deepEqual(await store.savedStats([a.slug, b.slug, fresh("none")], NOW - DAY), new Map([[a.slug, stats], [b.slug, empty]]));
    assert.deepEqual([...(await store.savedStats([a.slug, b.slug], NOW - 15 * 60 * SECOND)).keys()], [a.slug], "a copy from before `since` is not used");
    assert.deepEqual(await store.savedStats([], 0), new Map());
    // A copy worked out earlier never replaces a later one, whichever is saved last.
    await store.saveStats(a, empty, NOW - SECOND);
    assert.deepEqual((await store.savedStats([a.slug], 0)).get(a.slug), stats);
    await store.saveStats(a, empty, NOW + SECOND);
    assert.deepEqual((await store.savedStats([a.slug], 0)).get(a.slug), empty);
  });

  test(`${name}: an API's saved stats are cleared when its record changes`, async () => {
    const store = await open();
    const a = { slug: fresh("api"), payTo: `0x${fresh("w")}` };
    const stats: Stats = { measured: 20, valid: 20, answerRate: 1, medianMs: 500, uptime: 1, lastSlash: null };
    const has = async () => (await store.savedStats([a.slug], 0)).has(a.slug);
    await store.saveStats(a, stats, NOW);
    await store.recordCall(call(a.slug, NOW, { valid: false, kind: "routed", payer: "0xp", counted: false, reason: "status 404" }));
    assert.equal(await has(), true, "a call that isn't counted changes nothing");
    await store.recordCall(call(fresh("other"), NOW));
    assert.equal(await has(), true, "nor does another API's call");
    await store.recordCall(call(a.slug, NOW));
    assert.equal(await has(), false, "a counted call");
    await store.saveStats(a, stats, NOW);
    await store.recordUptime(a.slug, false, NOW);
    assert.equal(await has(), false, "an uptime probe");
  });

  test(`${name}: a slash clears the saved stats of every API on that wallet`, async () => {
    const store = await open();
    const wallet = `0x${fresh("Wallet")}`;
    const [a, b, other] = [{ slug: fresh("api"), payTo: wallet }, { slug: fresh("api"), payTo: wallet.toLowerCase() }, { slug: fresh("api"), payTo: `0x${fresh("w")}` }];
    const stats: Stats = { measured: 20, valid: 20, answerRate: 1, medianMs: 500, uptime: 1, lastSlash: null };
    for (const api of [a, b, other]) await store.saveStats(api, stats, NOW);
    await store.recordSlash(a.slug, wallet.toUpperCase().replace("0X", "0x"), NOW);
    assert.deepEqual([...(await store.savedStats([a.slug, b.slug, other.slug], 0)).keys()], [other.slug]);
  });

  // The router itself on top of each store: a routed call from start to finish, then a wallet trying to push an API out.
  test(`${name}: the router runs on it`, async () => {
    const store = await open();
    const a: RoutableApi = {
      slug: fresh("api"), capability: "token-price", priceUsd: 0.01, payTo: `0x${fresh("wallet")}`, official: false, launched: true,
      formatOk: true, unlisted: false, mapping: { price_usd: "priceUsd", source: "source", as_of: "updatedAt" }, listedAt: NOW - 30 * DAY, apiOfTheWeek: false,
    };
    const router = createRouter({ store, apis: () => [a], isBonded: cachedBond(() => false) });
    const raw = { priceUsd: 0.0002, source: "pool", updatedAt: "2026-11-23T10:00:00Z", marketCapUsd: 200_000 };
    let settled = 0;
    const hooks: RouteHooks<{ payer: string }> = {
      paymentRequired: (api, routeId) => ({ payTo: api.payTo, route_id: routeId }),
      verify: (p) => ({ ok: true, payer: p.payer }),
      callApi: () => ({ status: 200, body: raw, ms: 400 }),
      settle: () => (settled += 1) > 0,
    };
    assert.equal((await startRoute(router, "token-price", { token: "0xabc" }, NOW, hooks)).status, 503, "no record yet: not routed");
    for (let i = 0; i < 20; i++) await recordMeasured(store, call(a.slug, NOW - 3600 * SECOND - i * SECOND));

    const out = await startRoute(router, "token-price", { token: "0xabc" }, NOW, hooks);
    assert.equal(out.status, 402);
    const routeId = (out.body as { route_id: string }).route_id;
    const res = await routePaidCall(router, routeId, { payer: "0xPayer" }, NOW, () => a, hooks);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { price_usd: 0.0002, source: "pool", as_of: "2026-11-23T10:00:00Z", raw });
    assert.equal(settled, 1);
    assert.equal((await routePaidCall(router, routeId, { payer: "0xPayer" }, NOW, () => a, hooks)).status, 400, "the route id is used up");

    await Promise.all(Array.from({ length: 40 }, (_, i) => recordMeasured(store, failed(a.slug, NOW + SECOND + i, "0xGriefer"))));
    const st = await statsFor(store, a, NOW + 2 * SECOND);
    assert.equal(st.measured, 20);
    assert.ok(Math.abs(st.answerRate - 19 / 20) < 1e-9, "one wallet's failures count once");
    assert.equal(eligible(a, st, NOW + 2 * SECOND), true);
  });
}

test("database: the tidy-up removes only what the router no longer reads", async () => {
  const db = await testDb();
  const store = routerStore(db);
  const slug = fresh("api");
  await store.recordUptime(slug, true, NOW - 31 * DAY);
  await store.recordUptime(slug, true, NOW - DAY);
  await store.recordCall(call(slug, NOW - 200 * DAY));
  const [oldRoute, liveRoute] = [fresh("route"), fresh("route")];
  await store.saveRoute({ id: oldRoute, capability: "token-price", inputs: {}, slug, tried: [], expires: NOW - 2 * DAY });
  await store.saveRoute({ id: liveRoute, capability: "token-price", inputs: {}, slug, tried: [], expires: NOW + 60 * SECOND });
  const [past, paused] = [`0x${fresh("p")}`, `0x${fresh("p")}`];
  await store.blockPayer(past, NOW - SECOND);
  await store.blockPayer(paused, NOW + DAY);
  const [gone, live] = [{ slug: fresh("api"), payTo: "0xw" }, { slug: fresh("api"), payTo: "0xw" }];
  const stats: Stats = { measured: 20, valid: 20, answerRate: 1, medianMs: 500, uptime: 1, lastSlash: null };
  await store.saveStats(gone, stats, NOW - 2 * DAY);
  await store.saveStats(live, stats, NOW - 3600 * SECOND);
  const cap = fresh("cap");
  await store.saveProbeInput({ capability: cap, inputs: { token: "0xold" }, slug, payer: "0xagent", at: NOW - 31 * DAY });
  await store.saveProbeInput({ capability: cap, inputs: { token: "0xnew" }, slug, payer: "0xagent", at: NOW - DAY });

  await pruneRouterRecord(db, NOW);

  assert.equal(await store.answeredBefore(cap, { token: "0xold" }, slug), false, "probe inputs older than 30 days are gone");
  assert.equal(await store.answeredBefore(cap, { token: "0xnew" }, slug), true);

  assert.deepEqual([...(await store.savedStats([gone.slug, live.slug], 0)).keys()], [live.slug], "saved stats nothing refreshed for a day are for an API that is gone");
  assert.deepEqual(await store.uptime(slug, 0), { up: 1, total: 1 });
  assert.equal((await store.countedCalls(slug, 0, 10, CAP)).length, 1, "measured calls are kept");
  assert.equal(await store.blockedUntil(past), null);
  assert.equal(await store.blockedUntil(paused), NOW + DAY);
  assert.ok(await store.takeRoute(liveRoute, NOW));
});
