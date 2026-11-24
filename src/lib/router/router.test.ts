// Offline tests for the router: no network, no database. Ported from the router's Python reference tests, plus tests
// for what changed in the port (see the notes on each).
// Run: npx tsx --test src/lib/router/router.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPABILITIES, ROUTER, cachedBond, candidates, checkAnswer, createRouter, eligible, fillPath, mapAnswer, memoryStore, notReadyWait, openRouteByPayment,
  parseRetryAfter, pick, probesDue, recordMeasured, recordProbe, refreshStats, routePaidCall, speed, startRoute, statsFor, uptimeDue,
  type Outcome, type RoutableApi, type RouteHooks, type RouterStore,
} from "@/lib/router/router";

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const SAFE = "0x92a99FBD386F87277b6009BFF4C56728Ec5f7354";
const PRICE = "token-price";

/** A small seeded random generator, so every run picks the same way. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function api(slug: string, priceUsd = 0.01, over: Partial<RoutableApi> = {}): RoutableApi {
  return {
    slug,
    capability: PRICE,
    priceUsd,
    payTo: `0x${Buffer.from(slug).toString("hex").padEnd(40, "0").slice(0, 40)}`,
    official: false,
    launched: true,
    formatOk: true,
    unlisted: false,
    mapping: null,
    listedAt: NOW - 30 * DAY,
    apiOfTheWeek: false,
    ...over,
  };
}

/** A store, a fake bond lookup and a list of APIs. */
function world(apis: RoutableApi[], opts: { bonded?: string[]; seed?: number } = {}) {
  const store: RouterStore = memoryStore();
  const bonded = new Set((opts.bonded ?? []).map((w) => w.toLowerCase()));
  // What a test may change after the world is made: the list of APIs and the bond lookup.
  const state = { apis, lookups: 0, lookup: (wallet: string): boolean => bonded.has(wallet) };
  const router = createRouter({
    store,
    apis: () => state.apis,
    isBonded: cachedBond((wallet) => {
      state.lookups += 1;
      return state.lookup(wallet);
    }),
    random: seeded(opts.seed ?? 1),
  });
  return Object.assign(state, {
    store,
    router,
    bySlug: (slug: string) => state.apis.find((a) => a.slug === slug),
    /** n paid probes, the first `valid` of them good, one second apart going back from `at`. */
    async history(slug: string, n = 20, o: { valid?: number; ms?: number; at?: number } = {}) {
      const at = o.at ?? NOW - HOUR;
      for (let i = 0; i < n; i++) {
        await recordMeasured(store, { slug, at: at - i * SECOND, valid: i < (o.valid ?? n), ms: o.ms ?? 500, kind: "probe", payer: "", settled: false, reason: "" });
      }
    },
    slugs: async (now = NOW) => (await candidates(router, PRICE, now)).map((c) => c.api.slug),
  });
}

const GOOD = { price_usd: 0.0002, source: "pool", as_of: "2026-11-22T10:00:00Z" };
const valid = (capability: string, answer: unknown) => checkAnswer(capability, answer).valid;

// ---------- answers ----------

test("an answer is valid only with every required field, of the right kind", () => {
  assert.equal(valid(PRICE, GOOD), true);
  assert.equal(valid(PRICE, {}), false);
  assert.equal(valid(PRICE, { ...GOOD, price_usd: "" }), false);
  assert.equal(valid(PRICE, { ...GOOD, price_usd: true }), false);
  assert.equal(valid(PRICE, { ...GOOD, price_usd: Number.NaN }), false);
  assert.equal(valid(PRICE, { ...GOOD, price_usd: "0.0002" }), true, "a number sent as text is accepted");
  assert.equal(valid(PRICE, { ...GOOD, price_usd: "0x10" }), false, "only plain decimal numbers");
  assert.equal(valid(PRICE, [GOOD]), false);
  assert.equal(valid("nope", GOOD), false);
});

test("lists may be empty where the spec says so, and ranges are checked", () => {
  assert.equal(valid("token-risk", { score: 40, level: "medium", flags: [] }), true);
  assert.equal(valid("token-risk", { score: 140, level: "x", flags: [] }), false);
  assert.equal(valid("token-holders", { top_holders: [], linked_groups: [], snipers: [] }), false, "top_holders can't be empty");
  assert.equal(valid("payment-check", { confirmed: "yes", amount: 1, from: "a", to: "b" }), false);
});

test("a mapping turns an API's own answer into the standard fields", () => {
  const raw = { data: { usd: 1.5, src: "dex" }, ts: 5 };
  const mapping = { price_usd: "data.usd", source: "data.src", as_of: "ts" };
  assert.deepEqual(mapAnswer(raw, mapping), { price_usd: 1.5, source: "dex", as_of: 5 });
  assert.equal(valid(PRICE, mapAnswer(raw, mapping)), true);
  assert.equal(valid(PRICE, mapAnswer({}, mapping)), false);
  assert.deepEqual(mapAnswer(raw, null), raw, "no mapping: the answer is used as it is");
});

// New in the port: the official Payment Check keeps from, to and amount inside a list.
test("a mapping can read inside a list", () => {
  const raw = { paid: true, payments: [{ from: "0xa", to: "0xb", amount: "0.01" }] };
  const mapping = { confirmed: "paid", amount: "payments.0.amount", from: "payments.0.from", to: "payments.0.to" };
  assert.deepEqual(mapAnswer(raw, mapping), { confirmed: true, amount: "0.01", from: "0xa", to: "0xb" });
  assert.equal(valid("payment-check", mapAnswer(raw, mapping)), true);
  assert.equal(valid("payment-check", mapAnswer({ paid: true, payments: [] }, mapping)), false);
});

test("there are 8 capabilities, each with required fields", () => {
  assert.equal(Object.keys(CAPABILITIES).length, 8);
  for (const [name, fields] of Object.entries(CAPABILITIES)) assert.ok(Object.keys(fields).length > 0, name);
});

// ---------- eligibility ----------

test("an API needs 20 measured calls and 95% valid answers", async () => {
  const w = world([api("a"), api("b"), api("c")]);
  await w.history("a", 20);
  await w.history("b", 19);
  await w.history("c", 20, { valid: 18 }); // 90%
  assert.deepEqual(await w.slugs(), ["a"]);
  await w.history("c", 20, { valid: 19, at: NOW - 60 * SECOND }); // the last 20 are now 19 of 20
  assert.ok((await w.slugs()).includes("c"));
});

test("calls older than 30 days don't count", async () => {
  const w = world([api("a")]);
  await w.history("a", 20, { at: NOW - 31 * DAY });
  assert.deepEqual(await w.slugs(), []);
});

test("unlisted, not launched or without a format test: not routed", async () => {
  const w = world([api("a", 0.01, { unlisted: true }), api("b", 0.01, { launched: false }), api("c", 0.01, { formatOk: false })]);
  for (const s of "abc") await w.history(s);
  assert.deepEqual(await w.slugs(), []);
});

test("a slash takes every API of that wallet out for 30 days", async () => {
  const wallet = `0x${"1".repeat(40)}`;
  const w = world([api("a", 0.01, { payTo: wallet }), api("b", 0.01, { payTo: wallet }), api("c")]);
  for (const s of "abc") await w.history(s);
  await w.store.recordSlash("a", wallet, NOW - 10 * DAY);
  assert.deepEqual(await w.slugs(), ["c"]);
  // Fresh probes, so the record is still inside its 30 days when the slash runs out.
  for (const s of "abc") await w.history(s, 20, { at: NOW + 20 * DAY });
  assert.equal((await w.slugs(NOW + 21 * DAY)).length, 3);
});

test("direct calls by name are never measured", async () => {
  const store = memoryStore();
  await assert.rejects(recordMeasured(store, { slug: "a", at: NOW, valid: true, ms: 500, kind: "direct" as "probe", payer: "", settled: true, reason: "" }));
});

// ---------- choosing ----------

test("bonded APIs come first, but only up to twice the cheapest price", async () => {
  const [cheap, b1, b2] = [api("cheap", 0.01), api("b1", 0.02), api("b2", 0.021)];
  const w = world([cheap, b1, b2], { bonded: [b1.payTo, b2.payTo] });
  for (const s of ["cheap", "b1", "b2"]) await w.history(s);
  const tiers = Object.fromEntries((await candidates(w.router, PRICE, NOW)).map((c) => [c.api.slug, c.tier]));
  assert.deepEqual(tiers, { b1: 1, cheap: 2, b2: 2 });
  assert.equal((await pick(w.router, PRICE, NOW))?.api.slug, "b1");
});

test("official APIs are never tier 1", async () => {
  const w = world([api("off", 0.01, { official: true, payTo: SAFE })], { bonded: [SAFE] });
  await w.history("off");
  assert.equal((await candidates(w.router, PRICE, NOW))[0].tier, 2);
});

test("a bond never puts a bad API ahead", async () => {
  const [bad, good] = [api("bad"), api("good")];
  const w = world([bad, good], { bonded: [bad.payTo] });
  await w.history("bad", 20, { valid: 17 });
  await w.history("good");
  assert.equal((await pick(w.router, PRICE, NOW))?.api.slug, "good");
});

test("the score is quality times the square root of the price ratio", async () => {
  const w = world([api("a", 0.01), api("b", 0.04)]);
  await w.history("a");
  await w.history("b");
  const score = Object.fromEntries((await candidates(w.router, PRICE, NOW)).map((c) => [c.api.slug, c.score]));
  assert.ok(Math.abs(score.a - 1) < 1e-9);
  assert.ok(Math.abs(score.b - 0.5) < 1e-9, "4 times the price: half the score");
});

test("speed is full at 1 s and zero at 10 s", () => {
  assert.equal(speed(300), 1);
  assert.equal(speed(10_000), 0);
  assert.ok(Math.abs(speed(5500) - 0.5) < 1e-9);
  assert.equal(speed(null), 0);
});

// New. A swap quote runs its token checks before it answers, so marks made for a price lookup would always give it
// zero for speed. APIs only compete inside their own service, so that service has slower marks.
test("a service that is slower by nature has its own speed marks", async () => {
  assert.equal(speed(5000, "swap-quote"), 1);
  assert.equal(speed(25_000, "swap-quote"), 0);
  assert.ok(Math.abs(speed(15_000, "swap-quote") - 0.5) < 1e-9);
  assert.ok(Math.abs(speed(5500, PRICE) - 0.5) < 1e-9, "other services keep the general marks");
  assert.equal(speed(5500, "no-such-service"), speed(5500));
  // And the score uses them: two APIs that both take 6 seconds, one for each service.
  const w = world([api("swap", 0.01, { capability: "swap-quote" }), api("price")]);
  for (const slug of ["swap", "price"]) await w.history(slug, 20, { ms: 6000 });
  const [swap] = await candidates(w.router, "swap-quote", NOW);
  const [price] = await candidates(w.router, PRICE, NOW);
  assert.ok(Math.abs(swap.score - (0.7 + 0.3 * 0.95)) < 1e-9);
  assert.ok(Math.abs(price.score - (0.7 + 0.3 * (4 / 9))) < 1e-9);
});

test("close APIs share the traffic, and ones far behind get none", async () => {
  const w = world([api("a", 0.01), api("b", 0.0105), api("c", 0.02)], { seed: 3 });
  for (const s of "abc") await w.history(s);
  const picks: Record<string, number> = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 20_000; i++) picks[(await pick(w.router, PRICE, NOW))!.api.slug] += 1;
  assert.ok(picks.a > picks.b, "the better score gets more");
  assert.ok(picks.b > 6000, "within 10%: a real share");
  assert.equal(picks.c, 0, "29% behind: none");
});

test("the API of the week bonus stays inside its tier", async () => {
  const [bonded, week] = [api("bonded"), api("week", 0.01, { apiOfTheWeek: true })];
  const w = world([bonded, week], { bonded: [bonded.payTo] });
  await w.history("bonded", 20, { ms: 4000 });
  await w.history("week", 20, { ms: 200 });
  assert.equal((await pick(w.router, PRICE, NOW))?.api.slug, "bonded");
});

test("the bond is looked up once every 5 minutes, and a failed lookup means tier 2", async () => {
  const a = api("a");
  const w = world([a], { bonded: [a.payTo] });
  await w.history("a");
  for (let i = 0; i < 5; i++) assert.equal((await candidates(w.router, PRICE, NOW))[0].tier, 1);
  assert.equal(w.lookups, 1);
  await candidates(w.router, PRICE, NOW + 301 * SECOND);
  assert.equal(w.lookups, 2);
  w.lookup = () => {
    throw new Error("rpc down");
  };
  assert.equal((await candidates(w.router, PRICE, NOW + 1000 * SECOND))[0].tier, 2);
});

// ---------- the saved stats ----------

// New. Picking an API used to count every API's calls again on each request: three reads per API. Now each API's
// stats are saved, and a request reads the saved copies in one go.
function counting(store: RouterStore) {
  const reads = { counted: 0, uptime: 0, slash: 0, saved: 0 };
  const wrapped: RouterStore = {
    ...store,
    countedCalls: (...a) => (reads.counted++, store.countedCalls(...a)),
    uptime: (...a) => (reads.uptime++, store.uptime(...a)),
    lastSlash: (...a) => (reads.slash++, store.lastSlash(...a)),
    savedStats: (...a) => (reads.saved++, store.savedStats(...a)),
  };
  return { wrapped, reads };
}

test("picking an API reads the saved stats, and only counts calls for an API that has none", async () => {
  const w = world([api("a"), api("b", 0.0102), api("c", 0.0104), api("other", 0.01, { capability: "token-risk" })]);
  for (const slug of ["a", "b", "c", "other"]) await w.history(slug);
  const { wrapped, reads } = counting(w.store);
  const router = createRouter({ store: wrapped, apis: () => w.apis, isBonded: cachedBond(() => false), random: seeded(1) });
  assert.equal((await candidates(router, PRICE, NOW)).length, 3);
  assert.deepEqual(reads, { counted: 3, uptime: 3, slash: 3, saved: 1 }, "the first time: worked out and saved, for this service's APIs only");
  for (let i = 1; i <= 50; i++) assert.ok(await pick(router, PRICE, NOW + i * SECOND));
  assert.deepEqual(reads, { counted: 3, uptime: 3, slash: 3, saved: 51 }, "after that, one read a request");
  // A new API joins: it alone is worked out.
  w.apis = [...w.apis, api("d", 0.0103)];
  await w.history("d");
  assert.equal((await candidates(router, PRICE, NOW + 60 * SECOND)).length, 4);
  assert.deepEqual(reads, { counted: 4, uptime: 4, slash: 4, saved: 52 });
});

test("a change in an API's record shows on the very next request", async () => {
  const w = world([api("a"), api("b", 0.0102)]);
  for (const slug of ["a", "b"]) await w.history(slug);
  assert.deepEqual(await w.slugs(), ["a", "b"]);
  const fail = (payer: string) => recordMeasured(w.store, { slug: "a", at: NOW + SECOND, valid: false, ms: 1000, kind: "routed", payer, settled: false, reason: "status 500" });
  await fail("0x1");
  await fail("0x2"); // two failures in the last 20: under 95%
  assert.deepEqual(await w.slugs(NOW + 2 * SECOND), ["b"]);
  // A slash of b's wallet takes b out at once as well, though b's own record didn't change.
  await w.store.recordSlash("some-other-api", w.bySlug("b")!.payTo, NOW + 3 * SECOND);
  assert.deepEqual(await w.slugs(NOW + 4 * SECOND), []);
  // And an uptime probe changes the score at once.
  const c = world([api("c")]);
  await c.history("c");
  const score = async (now: number) => (await candidates(c.router, PRICE, now))[0].score;
  const before = await score(NOW);
  await c.store.recordUptime("c", false, NOW + SECOND);
  assert.ok((await score(NOW + 2 * SECOND)) < before);
});

test("saved stats are worked out again after 15 minutes, for what time alone changes", async () => {
  const w = world([api("a")]);
  // Twenty calls that leave the 30-day window five minutes from now.
  await w.history("a", 20, { at: NOW - 30 * DAY + 5 * 60 * SECOND + 20 * SECOND });
  assert.deepEqual(await w.slugs(NOW), ["a"]);
  assert.deepEqual(await w.slugs(NOW + 14 * 60 * SECOND), ["a"], "the saved copy is still used");
  assert.deepEqual(await w.slugs(NOW + 16 * 60 * SECOND), [], "worked out again: its calls are too old now");
});

test("the regular job's refresh keeps the saved copy fresh, so requests never count calls", async () => {
  const w = world([api("a")]);
  await w.history("a");
  const { wrapped, reads } = counting(w.store);
  const router = createRouter({ store: wrapped, apis: () => w.apis, isBonded: cachedBond(() => false), random: seeded(1) });
  for (let minute = 0; minute <= 60; minute += 5) {
    const t = NOW + minute * 60 * SECOND;
    await refreshStats(w.store, w.bySlug("a")!, t); // the job, every 5 minutes, on the store itself
    for (let i = 1; i <= 4; i++) assert.ok(await pick(router, PRICE, t + i * 60 * SECOND));
  }
  assert.equal(reads.counted, 0);
  assert.equal(reads.saved, 13 * 4);
});

test("no eligible API: nothing is picked", async () => {
  const w = world([api("a")]);
  assert.equal(await pick(w.router, PRICE, NOW), null);
});

// ---------- one routed request, with a fake gateway ----------

type Payment = { payTo: string; amount: number; payer: string };
type Answer = { status: number; body: unknown; ms: number; retryAfter?: number };

function flow(apis = [api("a", 0.01), api("b", 0.0102), api("c", 0.0104)], seed = 5) {
  const w = world(apis, { seed });
  // What a test may change: what each API answers, and whether settling works.
  const state = {
    answers: Object.fromEntries(apis.map((a) => [a.slug, { status: 200, body: GOOD, ms: 400 }])) as Record<string, Answer>,
    settled: [] as string[],
    settleOk: true,
  };
  const hooks: RouteHooks<Payment> = {
    paymentRequired: (a, routeId, validFor) => ({ payTo: a.payTo, amountUsd: a.priceUsd, route_id: routeId, maxTimeoutSeconds: validFor }),
    verify: (p, a) => ({ ok: p.payTo === a.payTo && p.amount >= a.priceUsd, payer: p.payer }),
    callApi: (a) => state.answers[a.slug],
    settle: (_p, a) => {
      if (state.settleOk) state.settled.push(a.slug);
      return state.settleOk;
    },
  };
  return Object.assign(state, {
    w,
    hooks,
    start: (now = NOW) => startRoute(w.router, PRICE, { token: "0xabc" }, now, hooks),
    /** Pays what a 402 asked for (or the "next" one inside a 502), unless told to pay something else. */
    pay(out: Outcome, o: { now?: number; payer?: string; payTo?: string; amount?: number } = {}) {
      const outer = out.body as Record<string, any>;
      const body = outer.next ?? outer;
      const payment: Payment = { payTo: o.payTo ?? body.payTo, amount: o.amount ?? body.amountUsd, payer: o.payer ?? "0xP" };
      return routePaidCall(w.router, body.route_id, payment, o.now ?? NOW, w.bySlug, hooks);
    },
    stats: (slug: string, now: number) => statsFor(w.store, w.bySlug(slug)!, now),
  });
}

async function ready(f: ReturnType<typeof flow>) {
  for (const a of f.w.apis) await f.w.history(a.slug);
  return f;
}

test("a routed call: 402 with a route id, then the answer once paid", async () => {
  const f = await ready(flow());
  const out = await f.start();
  assert.equal(out.status, 402);
  assert.equal((out.body as any).maxTimeoutSeconds, 55);
  const res = await f.pay(out);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, GOOD);
  assert.equal(res.headers["X-Autonomo-Bonded"], "false");
  assert.equal(f.settled.length, 1);
});

test("a route id works once, and for 60 seconds", async () => {
  const f = await ready(flow());
  const out = await f.start();
  assert.equal((await f.pay(out)).status, 200);
  assert.equal((await f.pay(out)).status, 400, "the same route id again");
  assert.equal((await f.pay(await f.start(), { now: NOW + 61 * SECOND })).status, 400);
  assert.equal(f.settled.length, 1);
});

test("a payment made out to another API is refused", async () => {
  const f = await ready(flow());
  assert.equal((await f.pay(await f.start(), { payTo: "0xsomeoneelse" })).status, 402);
  assert.deepEqual(f.settled, []);
});

test("a bad answer is not charged, and the next API is offered", async () => {
  const f = await ready(flow());
  const out = await f.start();
  const first = out.headers["X-Autonomo-Routed-To"];
  f.answers[first] = { status: 200, body: { price_usd: "" }, ms: 300 }; // a 200 with an empty field
  const res = await f.pay(out);
  assert.equal(res.status, 502);
  assert.deepEqual(f.settled, []);
  assert.notEqual((res.body as any).next.payTo, f.w.bySlug(first)!.payTo);
  const res2 = await f.pay(res); // a new signature, for the next API
  assert.equal(res2.status, 200);
  assert.equal(f.settled.length, 1);
  assert.notEqual(f.settled[0], first);
});

test("at most three APIs are tried, then it stops", async () => {
  const f = await ready(flow());
  for (const s of "abc") f.answers[s] = { status: 500, body: null, ms: 1000 };
  let res = await f.pay(await f.start());
  res = await f.pay(res);
  res = await f.pay(res);
  assert.equal(res.status, 502);
  assert.equal("next" in (res.body as object), false);
  assert.equal((res.body as any).tried.length, 3);
  assert.deepEqual(f.settled, []);
});

test("an answer slower than the gateway's limit is not charged", async () => {
  const f = await ready(flow());
  for (const s of "abc") f.answers[s] = { status: 200, body: GOOD, ms: 26_000 };
  assert.equal((await f.pay(await f.start())).status, 502);
  assert.deepEqual(f.settled, []);
});

test("a failed settlement gives no answer and pauses the wallet for 24 hours", async () => {
  const f = await ready(flow());
  f.settleOk = false;
  const res = await f.pay(await f.start(), { payer: "0xBad" });
  assert.equal(res.status, 402);
  assert.equal("price_usd" in (res.body as object), false);
  f.settleOk = true;
  assert.equal((await f.pay(await f.start(), { payer: "0xbad" })).status, 403);
  const later = NOW + DAY + SECOND;
  for (const a of f.w.apis) await f.w.history(a.slug, 20, { at: later - HOUR });
  assert.equal((await f.pay(await f.start(later), { now: later, payer: "0xbad" })).status, 200);
});

test("a failed routed call goes on the API's record", async () => {
  const f = await ready(flow());
  const out = await f.start();
  const target = out.headers["X-Autonomo-Routed-To"];
  f.answers[target] = { status: 500, body: null, ms: 1000 };
  await f.pay(out); // 1 failure on top of 20 good probes
  const st = await f.stats(target, NOW + SECOND);
  assert.equal(st.measured, 20, "still the last 20 only");
  assert.ok(Math.abs(st.answerRate - 0.95) < 1e-9);
});

test("\"no answer for this input\" is not charged and not held against the API", async () => {
  const f = await ready(flow());
  const out = await f.start();
  const target = out.headers["X-Autonomo-Routed-To"];
  f.answers[target] = { status: 404, body: { error: "unknown token" }, ms: 200 };
  const res = await f.pay(out);
  assert.equal(res.status, 502);
  assert.ok("next" in (res.body as object), "another API may know the token");
  assert.deepEqual(f.settled, []);
  assert.equal((await f.stats(target, NOW + SECOND)).answerRate, 1);
});

// ---------- "not ready yet" ----------

// New. Safe Swap answers 503 "try again in a minute" when a token's checks are still running, and the next call
// finds them done. Counted as a failure, two of those in 20 calls would take it out of routing.
const NOT_READY_YET: Answer = { status: 503, body: { error: "checks_slow" }, ms: 21_000, retryAfter: 60 };

test("an API that says \"not ready yet\" is not charged or marked down, and the agent is told when to call again", async () => {
  const f = await ready(flow());
  const out = await f.start();
  const slug = out.headers["X-Autonomo-Routed-To"];
  f.answers[slug] = NOT_READY_YET;
  const res = await f.pay(out);
  assert.equal(res.status, 503);
  assert.equal(res.headers["Retry-After"], "60");
  assert.equal((res.body as any).retry_after_seconds, 60);
  assert.equal(res.headers["X-Autonomo-Routed-To"], slug, "the same API again, not the next one");
  assert.equal((res.body as any).next.payTo, f.w.bySlug(slug)!.payTo);
  assert.deepEqual(f.settled, []);
  const st = await f.stats(slug, NOW + SECOND);
  assert.deepEqual([st.measured, st.answerRate], [20, 1], "nothing on its record");
  // After the wait the API has its answer, and the route given with the 503 pays for it.
  f.answers[slug] = { status: 200, body: GOOD, ms: 900 };
  const res2 = await f.pay(res, { now: NOW + 61 * SECOND });
  assert.equal(res2.status, 200);
  assert.deepEqual(f.settled, [slug]);
});

test("the route for the second call lasts until a minute after the wait", async () => {
  const f = await ready(flow());
  const again = async (at: number) => {
    const out = await f.start();
    f.answers[out.headers["X-Autonomo-Routed-To"]] = NOT_READY_YET;
    const res = await f.pay(out);
    for (const s of "abc") f.answers[s] = { status: 200, body: GOOD, ms: 900 };
    return (await f.pay(res, { now: at })).status;
  };
  assert.equal(await again(NOW + 119 * SECOND), 200);
  assert.equal(await again(NOW + 121 * SECOND), 400);
});

test("coming back before the wait is over doesn't call the API, so being early can't count against it", async () => {
  const f = await ready(flow());
  let calls = 0;
  const callApi = f.hooks.callApi;
  f.hooks.callApi = (a, inputs) => {
    calls += 1;
    return callApi(a, inputs);
  };
  const out = await f.start();
  const slug = out.headers["X-Autonomo-Routed-To"];
  f.answers[slug] = NOT_READY_YET;
  const res = await f.pay(out);
  const early = await f.pay(res, { now: NOW + 20 * SECOND });
  assert.equal(early.status, 503);
  assert.equal(early.headers["Retry-After"], "40", "what is left of the wait");
  assert.equal(calls, 1, "the API was not asked a second time");
  assert.equal((await f.stats(slug, NOW + 21 * SECOND)).answerRate, 1);
  // A payment that doesn't verify during the wait doesn't shorten the route either.
  const refused = await f.pay(early, { now: NOW + 30 * SECOND, payTo: "0xsomeoneelse" });
  assert.equal(refused.status, 402);
  f.answers[slug] = { status: 200, body: GOOD, ms: 900 };
  assert.equal((await f.pay(refused, { now: NOW + 100 * SECOND })).status, 200);
  assert.equal(calls, 2);
});

test("\"not ready yet\" a second time, after the wait, counts against the API and the next one is offered", async () => {
  const f = await ready(flow());
  const out = await f.start();
  const slug = out.headers["X-Autonomo-Routed-To"];
  f.answers[slug] = NOT_READY_YET;
  const res = await f.pay(out);
  const res2 = await f.pay(res, { now: NOW + 61 * SECOND });
  assert.equal(res2.status, 502);
  assert.match((res2.body as any).error, /not ready after waiting/);
  assert.notEqual(res2.headers["X-Autonomo-Routed-To"], slug);
  assert.deepEqual(f.settled, []);
  assert.ok(Math.abs((await f.stats(slug, NOW + 62 * SECOND)).answerRate - 0.95) < 1e-9);
  // The first API counts as one of the three tried, once.
  const res3 = await f.pay(res2, { now: NOW + 62 * SECOND });
  assert.equal(res3.status, 200);
});

test("only a 503 that asks for up to two minutes is \"not ready yet\"", async () => {
  assert.equal(notReadyWait(503, 60), 60);
  assert.equal(notReadyWait(503, 120), 120);
  assert.equal(notReadyWait(503, 121), null, "a longer wait is an API that is down");
  assert.equal(notReadyWait(503, null), null);
  assert.equal(notReadyWait(503, 0), null);
  assert.equal(notReadyWait(429, 60), null, "too many requests is the API's own problem");
  assert.equal(notReadyWait(500, 60), null);
  assert.equal(parseRetryAfter("60"), 60);
  assert.equal(parseRetryAfter(" 5 "), 5);
  assert.equal(parseRetryAfter("Wed, 25 Nov 2026 07:28:00 GMT"), null);
  assert.equal(parseRetryAfter(null), null);
  // In a routed call, a 503 that asks for ten minutes is a failure like any other.
  const f = await ready(flow());
  const out = await f.start();
  const slug = out.headers["X-Autonomo-Routed-To"];
  f.answers[slug] = { status: 503, body: null, ms: 500, retryAfter: 600 };
  assert.equal((await f.pay(out)).status, 502);
  assert.ok((await f.stats(slug, NOW + SECOND)).answerRate < 1);
});

test("a probe that hears \"not ready yet\" is asked once more, and the second answer counts", async () => {
  const w = world([api("a")]);
  await w.history("a", 20, { at: NOW - 2 * DAY });
  const due = async (now: number) => (await probesDue(w.router, now)).map((a) => a.slug);
  const rate = async (now: number) => (await statsFor(w.store, w.bySlug("a")!, now)).answerRate;
  const notReady = { valid: false, reason: "the API says it is not ready yet", ms: 21_000, notReady: true };
  const MINUTE = 60 * SECOND;
  assert.deepEqual(await due(NOW), ["a"]);
  assert.equal(await recordProbe(w.router, "a", notReady, NOW), true, "waiting for a second answer");
  assert.equal(await rate(NOW + SECOND), 1, "not marked down");
  assert.deepEqual(await due(NOW + MINUTE), [], "not before the longest wait an API may ask for");
  assert.deepEqual(await due(NOW + 2 * MINUTE), ["a"]);
  // Ready the second time: back to one probe a day.
  assert.equal(await recordProbe(w.router, "a", { valid: true, reason: "ok", ms: 800, notReady: false }, NOW + 5 * MINUTE), false);
  assert.equal(await rate(NOW + 6 * MINUTE), 1);
  assert.deepEqual(await due(NOW + 10 * MINUTE), []);
  // Two days later it says "not ready yet" twice in a row: the second one is a failed probe.
  const t = NOW + 2 * DAY;
  assert.equal(await recordProbe(w.router, "a", notReady, t), true);
  assert.equal(await recordProbe(w.router, "a", notReady, t + 5 * MINUTE), false);
  assert.ok(Math.abs((await rate(t + 6 * MINUTE)) - 0.95) < 1e-9);
  assert.equal((await w.store.lastProbe("a"))?.reason, "not ready after waiting");
});

// Changed in the port. The reference counted 3 failures per payer per day, which already drops an API to 85%,
// under the 95% it needs. Here a payer's failures count once a day, so one wallet alone can't take an API out.
test("one wallet cannot push an API out of routing", async () => {
  const f = await ready(flow());
  const a = f.w.bySlug("a")!;
  const fail = (payer: string, at: number) => recordMeasured(f.w.store, { slug: "a", at, valid: false, ms: 1000, kind: "routed", payer, settled: false, reason: "status 500" });
  for (let i = 0; i < 500; i++) await fail("0xGriefer", NOW + i); // 500 failed calls from one payer, same day
  let st = await f.stats("a", NOW + SECOND);
  assert.equal(st.measured, 20);
  assert.ok(Math.abs(st.answerRate - 19 / 20) < 1e-9, "only one of them counts");
  assert.equal(eligible(a, st, NOW + SECOND), true);
  for (let i = 0; i < 3; i++) await fail(`0xp${i}`, NOW + 2 * SECOND + i); // failures from other payers still count
  st = await f.stats("a", NOW + 3 * SECOND);
  assert.ok(Math.abs(st.answerRate - 16 / 20) < 1e-9);
  assert.equal(eligible(a, st, NOW + 3 * SECOND), false);
  for (let i = 0; i < 3; i++) await fail("0xgriefer", NOW + DAY + i); // the same payer the next day: counts once more
  assert.ok(Math.abs((await f.stats("a", NOW + DAY + SECOND)).answerRate - 15 / 20) < 1e-9);
});

test("a payment that doesn't match gets a fresh route id for the same API", async () => {
  const f = await ready(flow());
  const out = await f.start();
  const res = await f.pay(out, { amount: 0.001 }); // underpaid
  assert.equal(res.status, 402);
  assert.notEqual((res.body as any).route_id, (out.body as any).route_id);
  assert.equal(res.headers["X-Autonomo-Routed-To"], out.headers["X-Autonomo-Routed-To"]);
  assert.equal((await f.pay(res)).status, 200, "paying again with the new one works");
});

test("429, 408 and redirects count against the API", async () => {
  for (const status of [429, 408, 302]) {
    const f = await ready(flow([api("a")]));
    f.answers.a = { status, body: GOOD, ms: 300 };
    await f.pay(await f.start());
    assert.ok((await f.stats("a", NOW + SECOND)).answerRate < 1, String(status));
    assert.deepEqual(f.settled, []);
  }
});

test("free APIs are not routed", async () => {
  const w = world([api("free", 0)]);
  await w.history("free");
  assert.deepEqual(await w.slugs(), []);
});

test("an unknown capability is a 404, and an empty pool a 503", async () => {
  const f = await ready(flow());
  assert.equal((await startRoute(f.w.router, "nope", {}, NOW, f.hooks)).status, 404);
  const empty = flow([]);
  assert.equal((await startRoute(empty.w.router, PRICE, { token: "0xabc" }, NOW, empty.hooks)).status, 503);
});

// New in the port: with a mapping, the reference returned the standard fields only and dropped the rest.
test("with a mapping, the agent gets the standard fields and the API's whole answer", async () => {
  const mapping = { price_usd: "priceUsd", source: "source", as_of: "updatedAt" };
  const f = await ready(flow([api("a", 0.01, { mapping })]));
  const raw = { priceUsd: 0.0002, source: "pool", updatedAt: "2026-11-23T10:00:00Z", marketCapUsd: 200_000 };
  f.answers.a = { status: 200, body: raw, ms: 300 };
  const res = await f.pay(await f.start());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { price_usd: 0.0002, source: "pool", as_of: "2026-11-23T10:00:00Z", raw });
});

// ---------- probes ----------

test("three paid probes a day in the first week, then one", async () => {
  const w = world([api("new", 0.01, { listedAt: NOW - 2 * DAY }), api("old")]);
  await w.history("old", 20, { at: NOW - 2 * DAY }); // on its record, last probed two days ago
  const due = async (now: number) => (await probesDue(w.router, now)).map((a) => a.slug).sort();
  assert.deepEqual(await due(NOW), ["new", "old"]);
  for (const slug of ["new", "old"]) await recordMeasured(w.store, { slug, at: NOW, valid: true, ms: 400, kind: "probe", payer: "", settled: true, reason: "" });
  assert.deepEqual(await due(NOW + 7 * HOUR), []);
  assert.deepEqual(await due(NOW + 9 * HOUR), ["new"]);
  assert.deepEqual(await due(NOW + 25 * HOUR), ["new", "old"]);
});

test("a new API becomes eligible after about a week of probes", async () => {
  const w = world([api("new", 0.01, { listedAt: NOW })]);
  let t = NOW;
  while (!(await w.slugs(t)).length) {
    for (const a of await probesDue(w.router, t)) await recordMeasured(w.store, { slug: a.slug, at: t, valid: true, ms: 400, kind: "probe", payer: "", settled: true, reason: "" });
    t += HOUR;
    assert.ok(t < NOW + 8 * DAY, "never became eligible");
  }
  assert.ok(t > NOW + 6 * DAY);
});

// New in the port. With one probe a day, two failed probes kept an API out for 20 days.
test("an API that fell out is probed three times a day, and is back in about a week", async () => {
  const w = world([api("a")]);
  const probe = (at: number, ok: boolean) => recordMeasured(w.store, { slug: "a", at, valid: ok, ms: 400, kind: "probe", payer: "", settled: ok, reason: "" });
  for (let d = 25; d >= 1; d--) await probe(NOW - d * DAY, true);
  await probe(NOW, false);
  await probe(NOW + DAY, false);
  let t = NOW + DAY + HOUR;
  assert.deepEqual(await w.slugs(t), []);
  let probes = 0;
  while (!(await w.slugs(t)).length) {
    for (const a of await probesDue(w.router, t)) {
      await probe(t, true);
      probes += 1;
      assert.equal(a.slug, "a");
    }
    t += HOUR;
    assert.ok(t < NOW + 9 * DAY, "still out after 9 days");
  }
  assert.ok(probes >= 19, "the first failure has to leave the last 20");
  // Back on its record: one probe a day again.
  await probe(t, true);
  assert.deepEqual(await probesDue(w.router, t + 9 * HOUR), []);
});

test("uptime is probed every 15 minutes and feeds the score", async () => {
  const w = world([api("a")]);
  assert.equal((await uptimeDue(w.router, NOW)).length, 1);
  await w.store.recordUptime("a", true, NOW);
  assert.deepEqual(await uptimeDue(w.router, NOW + 10 * 60 * SECOND), []);
  assert.equal((await uptimeDue(w.router, NOW + 15 * 60 * SECOND)).length, 1);
  const b = api("b");
  w.apis.push(b);
  for (let i = 0; i < 10; i++) await w.store.recordUptime("b", i < 5, NOW - i * 60 * SECOND);
  assert.ok(Math.abs((await statsFor(w.store, b, NOW)).uptime - 0.5) < 1e-9);
});

// ---------- random worlds ----------

test("random worlds respect the rules", async () => {
  const rnd = seeded(11);
  const choice = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
  for (let n = 0; n < 150; n++) {
    const apis = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => api(`x${i}`, choice([0.005, 0.01, 0.015, 0.03]), { official: rnd() < 0.2 }));
    const w = world(apis, { bonded: apis.filter(() => rnd() < 0.5).map((a) => a.payTo), seed: Math.floor(rnd() * 10_000) });
    for (const a of apis) await w.history(a.slug, 20, { valid: choice([17, 19, 20]), ms: choice([200, 2000, 8000]) });
    const all = await candidates(w.router, PRICE, NOW);
    if (!all.length) continue;
    const cheapest = Math.min(...all.map((c) => c.api.priceUsd));
    for (const c of all) {
      assert.ok(c.stats.answerRate >= ROUTER.minAnswerRate);
      if (c.tier === 1) {
        assert.equal(c.api.official, false);
        assert.ok(c.api.priceUsd <= 2 * cheapest);
      }
    }
    const p = (await pick(w.router, PRICE, NOW))!;
    assert.equal(p.tier, all[0].tier);
    assert.ok(p.score >= all[0].score * 0.9 - 1e-12);
  }
});

// ---------- inputs (new in the port: the reference left them to the gateway) ----------

test("a request without its required input is refused before any API is picked", async () => {
  const f = await ready(flow());
  const out = await startRoute(f.w.router, PRICE, { chain: "base" }, NOW, f.hooks);
  assert.equal(out.status, 400);
  assert.deepEqual((out.body as any).inputs, ["token"]);
  assert.equal((await startRoute(f.w.router, "job-finder", {}, NOW, f.hooks)).status, 503, "job-finder needs no input; no API serves it here");
});

test("a path template is filled from the inputs", () => {
  const path = (template: string, inputs: Record<string, string>) => {
    const r = fillPath(template, inputs);
    return r.ok ? r.path : `refused: ${r.error}`;
  };
  assert.equal(path("/price/{token}?chain={chain}", { token: "0xabc", chain: "base" }), "/price/0xabc?chain=base");
  assert.equal(path("/price/{token}?chain={chain}", { token: "0xabc" }), "/price/0xabc", "an input missing from the query is left out");
  assert.equal(path("/site?url={url}&full=1", { url: "https://a.com/b?c=d" }), "/site?url=https%3A%2F%2Fa.com%2Fb%3Fc%3Dd&full=1");
  assert.equal(path("/jobs", { skills: "x" }), "/jobs", "inputs the template doesn't name are not sent");
  assert.match(path("/price/{token}", {}), /^refused/, "an input in the path is required");
  assert.match(path("/price/{token}", { token: ".." }), /^refused/, "can't step out of the API's path");
  assert.equal(path("/price/{token}", { token: "a/../b" }), "/price/a%2F..%2Fb", "slashes are escaped");
  assert.match(path("price/{token}", { token: "x" }), /^refused/);
  assert.match(path("/price/{Token}", { Token: "x" }), /^refused/);
});

// New in the port: a standard x402 client repeats the request with its payment and nothing else.
test("a payment without a route id finds its route by what it pays for", async () => {
  const f = await ready(flow());
  const inputs = { token: "0xabc" };
  const first = await f.start();
  const slug = first.headers["X-Autonomo-Routed-To"];
  const other = f.w.apis.find((a) => a.slug !== slug)!;
  const by = (paysTo: string, i = inputs) => openRouteByPayment(f.w.router, PRICE, i, NOW, f.w.bySlug, (a) => a.payTo === paysTo);
  assert.equal((await by(other.payTo)).ok, false, "a payment made out to another API finds nothing");
  assert.equal((await by(f.w.bySlug(slug)!.payTo, { token: "0xdef" })).ok, false, "nor one for another request");
  const opened = await by(f.w.bySlug(slug)!.payTo);
  assert.ok(opened.ok && opened.api.slug === slug && opened.route.id === first.headers["X-Autonomo-Route-Id"]);
  assert.equal((await by(f.w.bySlug(slug)!.payTo)).ok, false, "and only once");
});
