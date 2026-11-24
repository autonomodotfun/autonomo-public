// The /route endpoint's flow, with a fake payment wrapper in place of the real one: it answers 402 without a valid
// payment, otherwise runs the handler and "settles" only when the handler answers below 400, as the real wrapper does.
// Also the official APIs' settings, checked against their published example answers. No network, no database.
// Run: npx tsx --test src/lib/router/router-http.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Gateway } from "@/db/schema";
import EXAMPLES from "@/lib/gateway/bazaar-examples.json";
import { ROUTER, cachedBond, checkAnswer, createRouter, fillPath, mapAnswer, memoryStore, missingInputs, recordMeasured, statsFor, type RoutableApi } from "@/lib/router/router";
import { OFFICIAL_ROUTES, PROBE_INPUTS, formatTest, parseRouteSettings, probeApi, routeSettings, toRoutableApi, type RouteSettings } from "@/lib/router/router-apis";
import { handleRoute, type Routable, type RouteDeps } from "@/lib/router/router-http";
import { OFFICIAL_OWNER } from "@/lib/directory/track-record";

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const GOOD = { price_usd: 0.0002, source: "pool", as_of: "2026-11-22T10:00:00Z" };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const unb64 = (value: string | null) => (value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : null);

/** A fake gateway: where it is paid, its price and what its API answers. */
type Fake = { slug: string; payTo: string; price: number; answer: { status: number; body: unknown; ms: number; retryAfter?: number } };

function api(slug: string, priceUsd: number): RoutableApi {
  return {
    slug, capability: "token-price", priceUsd, payTo: `0xpay-${slug}`, official: false, launched: true, formatOk: true,
    unlisted: false, mapping: null, listedAt: NOW - 30 * 86_400_000, apiOfTheWeek: false,
  };
}

async function world(prices: Record<string, number> = { a: 0.01, b: 0.0102, c: 0.0104 }) {
  const store = memoryStore();
  const settings: RouteSettings = { capability: "token-price", path: "/price/{token}?chain={chain}", mapping: null };
  const all: Routable<Fake>[] = Object.entries(prices).map(([slug, price]) => {
    const a = api(slug, price);
    return { api: a, settings, gateway: { slug, payTo: a.payTo, price, answer: { status: 200, body: GOOD, ms: 400 } } };
  });
  for (const r of all) {
    for (let i = 0; i < 20; i++) await recordMeasured(store, { slug: r.api.slug, at: NOW - 3_600_000 - i * SECOND, valid: true, ms: 500, kind: "probe", payer: "", settled: false, reason: "" });
  }
  const router = createRouter({ store, apis: () => all.map((r) => r.api), isBonded: cachedBond(() => false), random: () => 0.5 });
  const w = {
    store,
    all,
    now: NOW,
    settleOk: true,
    /** Why a failed settlement failed, as the wrapper reports it. Empty: the payment service itself failed. */
    settleError: "invalid_exact_evm_insufficient_balance",
    settled: [] as string[],
    calls: [] as string[],
    logged: [] as number[],
    gateway: (slug: string) => all.find((r) => r.api.slug === slug)!.gateway,
    stats: (slug: string) => statsFor(store, all.find((r) => r.api.slug === slug)!.api, w.now + SECOND),
  };
  const required = (g: Fake, error?: string) =>
    new Response("{}", { status: 402, headers: { "payment-required": b64({ x402Version: 2, error, accepts: [{ payTo: g.payTo, amount: g.price, network: "eip155:4663" }] }) } });
  const deps: RouteDeps<Fake> = {
    router,
    now: () => w.now,
    load: async () => all,
    required: async (g) => required(g),
    async paid(g, request, inner) {
      const payment = unb64(request.headers.get("payment-signature"));
      if (!payment) return required(g);
      if (payment.accepted?.payTo !== g.payTo || payment.accepted?.amount < g.price) return required(g, "no matching payment requirements");
      const res = await inner();
      if (res.status >= 400) return res;
      if (!w.settleOk) {
        const headers: Record<string, string> = w.settleError ? { "payment-response": b64({ success: false, errorReason: w.settleError }) } : {};
        return new Response("{}", { status: 402, headers });
      }
      w.settled.push(g.slug);
      const out = new Response(res.body, { status: res.status, headers: res.headers });
      out.headers.set("payment-response", b64({ success: true, payer: payment.payload.authorization.from, transaction: "0xtx" }));
      return out;
    },
    paysFor: (g, accepted) => accepted.payTo === g.payTo,
    async call(g, path) {
      w.calls.push(`${g.slug}${path}`);
      return g.answer;
    },
    onPaid: (_g, _request, res) => void w.logged.push(res.status),
  };
  const url = (capability: string, query: string) => `https://autonomo.test/route/${capability}${query}`;
  const ask = (query = "?token=0xabc&chain=base", capability = "token-price", ip?: string) => handleRoute(new Request(url(capability, query)), capability, deps, ip);
  /** Pays what a 402 (or the "next" inside a 502) asked for, the way a client would. */
  const pay = async (
    asked: Response | Record<string, any>,
    o: { payer?: string; payTo?: string; amount?: number; routeId?: string | null; query?: string } = {},
  ) => {
    const body = asked instanceof Response ? await asked.clone().json() : asked;
    const required402 = body.next ?? body;
    const accepted = { ...required402.accepts[0], ...(o.payTo ? { payTo: o.payTo } : {}), ...(o.amount ? { amount: o.amount } : {}) };
    const headers: Record<string, string> = { "payment-signature": b64({ x402Version: 2, accepted, payload: { authorization: { from: o.payer ?? "0xPayer" } } }) };
    const routeId = o.routeId === undefined ? required402.route_id : o.routeId;
    if (routeId) headers["x-autonomo-route-id"] = routeId;
    return handleRoute(new Request(url("token-price", o.query ?? "?token=0xabc&chain=base"), { headers }), "token-price", deps);
  };
  return Object.assign(w, { ask, pay, deps });
}

test("an unpaid request gets the chosen API's own 402, with a route id", async () => {
  const w = await world();
  const res = await w.ask();
  assert.equal(res.status, 402);
  const slug = res.headers.get("x-autonomo-routed-to")!;
  const body = await res.json();
  assert.equal(body.route_id, res.headers.get("x-autonomo-route-id"));
  assert.equal(body.routed_to, slug);
  assert.equal(body.accepts[0].payTo, w.gateway(slug).payTo, "the body carries that API's requirements");
  assert.equal(unb64(res.headers.get("payment-required")).accepts[0].payTo, w.gateway(slug).payTo, "and the header is the wrapper's own");
  assert.deepEqual(w.calls, [], "no API is called before a payment");
});

test("a paid request is answered by that API, settled and logged", async () => {
  const w = await world();
  const first = await w.ask();
  const slug = first.headers.get("x-autonomo-routed-to")!;
  const res = await w.pay(first);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), GOOD);
  assert.equal(res.headers.get("x-autonomo-routed-to"), slug);
  assert.equal(res.headers.get("x-autonomo-bonded"), "false");
  assert.equal(unb64(res.headers.get("payment-response")).success, true);
  assert.deepEqual(w.settled, [slug]);
  assert.deepEqual(w.calls, [`${slug}/price/0xabc?chain=base`], "the inputs became that API's own path");
  assert.deepEqual(w.logged, [200]);
  assert.deepEqual(await w.store.probeInputs("token-price", 0, 50, 3), [{ token: "0xabc", chain: "base" }], "its inputs are kept for later probes");
  assert.equal(await w.store.answeredBefore("token-price", { token: "0xabc", chain: "base" }, slug), true);
  assert.equal((await w.pay(first)).status, 400, "the route id is used up");
});

test("a standard x402 client, which sends no route id, is matched by its payment", async () => {
  const w = await world();
  const first = await w.ask();
  const res = await w.pay(first, { routeId: null });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-autonomo-routed-to"), first.headers.get("x-autonomo-routed-to"));
  assert.equal((await w.pay(first, { routeId: null })).status, 400, "and only once");
  const other = await w.ask("?token=0xdef");
  assert.equal((await w.pay(other, { routeId: null })).status, 400, "a payment sent with a different request finds no route");
});

test("a bad answer is not charged; the 502 offers the next API, and paying that one works", async () => {
  const w = await world();
  const first = await w.ask();
  const slug = first.headers.get("x-autonomo-routed-to")!;
  w.gateway(slug).answer = { status: 200, body: { price_usd: "" }, ms: 300 };
  const res = await w.pay(first);
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /nothing was charged/);
  assert.deepEqual(w.settled, []);
  const next = res.headers.get("x-autonomo-routed-to")!;
  assert.notEqual(next, slug);
  assert.equal(body.next.accepts[0].payTo, w.gateway(next).payTo);
  const res2 = await w.pay(body);
  assert.equal(res2.status, 200);
  assert.deepEqual(w.settled, [next]);
  assert.ok((await w.stats(slug)).answerRate < 1, "the failure is on the first API's record");
});

test("\"no answer for this input\" moves on to the next API without counting against the first", async () => {
  const w = await world();
  const first = await w.ask();
  const slug = first.headers.get("x-autonomo-routed-to")!;
  w.gateway(slug).answer = { status: 404, body: { error: "not_found" }, ms: 200 };
  const res = await w.pay(first);
  assert.equal(res.status, 502);
  assert.ok((await res.json()).next);
  assert.equal((await w.stats(slug)).answerRate, 1);
});

test("\"not ready yet\" goes out as a 503 with Retry-After, is not settled, and its route pays for the second call", async () => {
  const w = await world();
  const first = await w.ask();
  const slug = first.headers.get("x-autonomo-routed-to")!;
  w.gateway(slug).answer = { status: 503, body: { error: "checks_slow" }, ms: 21_000, retryAfter: 60 };
  const res = await w.pay(first);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "60");
  assert.equal(res.headers.get("x-autonomo-routed-to"), slug);
  const body = await res.json();
  assert.equal(body.retry_after_seconds, 60);
  assert.equal(body.next.accepts[0].payTo, w.gateway(slug).payTo, "the same API's own requirements");
  assert.equal(body.next.route_id, res.headers.get("x-autonomo-route-id"));
  assert.deepEqual(w.settled, []);
  assert.equal((await w.stats(slug)).answerRate, 1);
  w.gateway(slug).answer = { status: 200, body: GOOD, ms: 900 };
  w.now = NOW + 61 * SECOND;
  const res2 = await w.pay(body);
  assert.equal(res2.status, 200);
  assert.deepEqual(w.settled, [slug]);
  assert.equal(w.calls.length, 2);
});

test("a payment made out to another API gets a 402 with a fresh route id for the same API", async () => {
  const w = await world();
  const first = await w.ask();
  const slug = first.headers.get("x-autonomo-routed-to")!;
  const res = await w.pay(first, { payTo: "0xsomeoneelse" });
  assert.equal(res.status, 402);
  assert.equal(res.headers.get("x-autonomo-routed-to"), slug);
  const body = await res.json();
  assert.notEqual(body.route_id, (await first.clone().json()).route_id);
  assert.equal(body.accepts[0].payTo, w.gateway(slug).payTo);
  assert.ok(res.headers.get("payment-required"));
  assert.deepEqual(w.calls, [], "the API was never called");
  assert.equal((await w.pay(body)).status, 200, "paying the right API with the new id works");
});

test("a failed settlement returns no answer and pauses the wallet", async () => {
  const w = await world();
  w.settleOk = false;
  const res = await w.pay(await w.ask(), { payer: "0xBad" });
  assert.equal(res.status, 402);
  assert.equal("price_usd" in (await res.json()), false);
  w.settleOk = true;
  const again = await w.pay(await w.ask(), { payer: "0xbad" });
  assert.equal(again.status, 403);
  assert.deepEqual(w.settled, []);
  assert.deepEqual(await w.store.probeInputs("token-price", 0, 50, 3), [], "a call that didn't settle leaves no probe input");
  assert.equal((await w.pay(await w.ask(), { payer: "0xgood" })).status, 200, "other wallets are not affected");
});

test("a settlement that failed through no fault of the payer gives no answer, and no pause", async () => {
  const w = await world();
  w.settleOk = false;
  w.settleError = "";
  const res = await w.pay(await w.ask(), { payer: "0xHonest" });
  assert.equal(res.status, 402);
  assert.equal("price_usd" in (await res.json()), false);
  w.settleOk = true;
  assert.equal((await w.pay(await w.ask(), { payer: "0xhonest" })).status, 200, "the wallet can pay again right away");
});

test("one address can't send more than its share of requests a minute", async () => {
  const w = await world();
  for (let i = 0; i < ROUTER.ratePerIpPerMinute; i++) assert.equal((await w.ask("?token=0xabc", "token-price", "203.0.113.7")).status, 402);
  const res = await w.ask("?token=0xabc", "token-price", "203.0.113.7");
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "60");
  assert.equal((await w.ask("?token=0xabc", "token-price", "203.0.113.8")).status, 402, "another address is not affected");
  w.now += 60_000;
  assert.equal((await w.ask("?token=0xabc", "token-price", "203.0.113.7")).status, 402, "a minute later it can ask again");
});

test("one wallet can't pay for more than its share of calls a minute, and the call past the limit is not charged", async () => {
  const w = await world();
  for (let i = 0; i < ROUTER.ratePerPayerPerMinute; i++) assert.equal((await w.pay(await w.ask(), { payer: "0xBusy" })).status, 200);
  const before = w.calls.length;
  const res = await w.pay(await w.ask(), { payer: "0xbusy" });
  assert.equal(res.status, 429);
  assert.equal(w.calls.length, before, "the API is not called");
  assert.equal(w.settled.length, ROUTER.ratePerPayerPerMinute, "and nothing more is settled");
  assert.equal((await w.pay(await w.ask(), { payer: "0xother" })).status, 200);
  // A payment that doesn't verify never counts against the wallet it names.
  const w2 = await world();
  for (let i = 0; i < ROUTER.ratePerPayerPerMinute + 5; i++) await w2.pay(await w2.ask(), { payer: "0xVictim", payTo: "0xsomeoneelse" });
  assert.equal((await w2.pay(await w2.ask(), { payer: "0xvictim" })).status, 200);
});

test("requests the router can't take: unknown capability, missing input, too many inputs, a route id for another request", async () => {
  const w = await world();
  assert.equal((await w.ask("?token=0xabc", "nope")).status, 404);
  assert.equal((await w.ask("?chain=base")).status, 400);
  assert.equal((await w.ask(`?token=0xabc&${Array.from({ length: 13 }, (_, i) => `p${i}=1`).join("&")}`)).status, 400);
  assert.equal((await w.pay(await w.ask(), { routeId: "made-up" })).status, 400);
});

test("no API eligible: 503, and nothing to pay", async () => {
  const w = await world({});
  const res = await w.ask();
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("payment-required"), null);
});

// ---------- which gateways are routable ----------

const row = (over: Partial<Gateway>) =>
  ({
    slug: "token-lookup", owner: OFFICIAL_OWNER, payTo: "0xSAFE", priceUsd: "0.010000", status: "active", listing: "listed",
    routeCapability: null, routePath: null, routeMapping: null, routeFormatOk: false, routeListedAt: null, createdAt: new Date(NOW),
    ...over,
  }) as Gateway;

test("an official API takes its settings from the list, and saved settings win", () => {
  const preset = toRoutableApi(row({}))!;
  assert.equal(preset.api.capability, "token-price");
  assert.equal(preset.api.official, true);
  assert.equal(preset.api.payTo, "0xsafe");
  assert.equal(preset.api.formatOk, false, "it still has to pass the format test");
  assert.equal(preset.api.listedAt, NOW);
  assert.deepEqual(preset.settings, OFFICIAL_ROUTES["token-lookup"]);
  const saved = routeSettings(row({ routeCapability: "token-risk", routePath: "/r/{token}", routeMapping: null }))!;
  assert.deepEqual(saved, { capability: "token-risk", path: "/r/{token}", mapping: null }, "another capability doesn't inherit the mapping");
});

test("a creator's API is routable only with a capability and a path of its own", () => {
  assert.equal(toRoutableApi(row({ owner: "0xcreator" })), null, "the official list is only for the official owner");
  assert.equal(toRoutableApi(row({ owner: "0xcreator", routeCapability: "token-price" })), null);
  assert.equal(toRoutableApi(row({ owner: "0xcreator", routeCapability: "made-up", routePath: "/p/{token}" })), null);
  assert.equal(toRoutableApi(row({ owner: "0xcreator", routeCapability: "token-price", routePath: "no-slash" })), null);
  const r = toRoutableApi(row({ owner: "0xcreator", payTo: null, routeCapability: "token-price", routePath: "/p/{token}", listing: "unlisted", status: "paused" }))!;
  assert.deepEqual([r.api.official, r.api.payTo, r.api.unlisted, r.api.launched], [false, "0xcreator", true, false]);
});

// ---------- the official APIs' settings ----------

test("every official API's path can be filled from its capability's known inputs", () => {
  for (const [slug, s] of Object.entries(OFFICIAL_ROUTES)) {
    const filled = fillPath(s.path, PROBE_INPUTS[s.capability]);
    assert.ok(filled.ok, slug);
  }
});

test("a routed swap quote becomes Safe Swap's own request, and needs the wallet that will sign", async () => {
  const s = OFFICIAL_ROUTES["safe-swap"];
  const inputs = { token_in: "0xaaa", token_out: "0xbbb", amount: "1000000", taker: "0xccc" };
  const filled = fillPath(s.path, inputs);
  assert.ok(filled.ok && filled.path === "/swap/quote?token_in=0xaaa&token_out=0xbbb&amount_in=1000000&taker=0xccc", "slippage is left out when it isn't given");
  const withSlippage = fillPath(s.path, { ...inputs, slippage_bps: "50" });
  assert.ok(withSlippage.ok && withSlippage.path.endsWith("&taker=0xccc&slippage_bps=50"));
  assert.deepEqual(missingInputs("swap-quote", { token_in: "0xaaa", token_out: "0xbbb", amount: "1" }), ["taker"]);
  assert.deepEqual(missingInputs("swap-quote", PROBE_INPUTS["swap-quote"]), []);
});

test("the format test passes a good API and says why a bad one fails", async () => {
  const s = OFFICIAL_ROUTES["token-risk"];
  const good = { risk: { score: 12, level: "low", flags: [] } };
  const paths: string[] = [];
  const ok = await formatTest(s, async (path) => (paths.push(path), { status: 200, body: good, ms: 300 }));
  assert.deepEqual([ok.ok, ok.reason], [true, "ok"]);
  assert.match(paths[0], /^\/risk\/0x[0-9a-fA-F]{40}\?chain=robinhood$/);
  assert.equal((await formatTest(s, async () => ({ status: 200, body: { risk: { level: "low", flags: [] } }, ms: 300 }))).reason, "missing score");
  assert.equal((await formatTest(s, async () => ({ status: 503, body: null, ms: 300 }))).reason, "the API answered 503");
  assert.equal((await formatTest(s, async () => ({ status: 200, body: null, ms: 300 }))).reason, "the answer is not JSON");
});

// The published example answers (the ones the Bazaar listings carry) are the nearest thing to a real call that can be
// checked offline. A mapping that doesn't fit its example is reported here by name.
//
// One known gap: Token Lookup's example has no `source`. The API's code sets it on every answer
// (official-apis/tools/api/price.js), so the example is taken to have been trimmed; the field is put back here. The
// format test, which makes a real call, is what settles it before the API can be routed.
const TRIMMED_FROM_EXAMPLE: Record<string, Record<string, unknown>> = {
  "token-lookup": { source: "Latest swap in the token's launchpad Uniswap v4 pool" },
};

test("each official mapping fits that API's published example answer", () => {
  const problems: string[] = [];
  for (const [slug, s] of Object.entries(OFFICIAL_ROUTES)) {
    const example = (EXAMPLES as Record<string, Record<string, unknown>>)[slug];
    if (!example) {
      problems.push(`${slug}: no example answer`);
      continue;
    }
    const check = checkAnswer(s.capability, mapAnswer({ ...example, ...TRIMMED_FROM_EXAMPLE[slug] }, s.mapping));
    if (!check.valid) problems.push(`${slug}: ${check.reason}`);
  }
  assert.deepEqual(problems, []);
});

// ---------- probes and settings typed into the admin form ----------

test("a probe fails on a bad answer, a 4xx or an answer slower than the gateway's limit", async () => {
  const s = OFFICIAL_ROUTES["token-risk"];
  const good = { risk: { score: 12, level: "low", flags: [] } };
  const fixed = { notReady: false, noData: false, real: null };
  assert.deepEqual(await probeApi(s, async () => ({ status: 200, body: good, ms: 300 })), { valid: true, reason: "ok", ms: 300, ...fixed });
  const notFound = await probeApi(s, async () => ({ status: 404, body: { error: "not_found" }, ms: 300 }));
  assert.deepEqual([notFound.valid, notFound.noData], [false, true], "on the fixed input a 4xx is a failure; recordProbe() decides for an agent's input");
  assert.equal((await probeApi(s, async () => ({ status: 429, body: null, ms: 300 }))).noData, false, "too many requests is the API's own problem");
  assert.deepEqual(await probeApi(s, async () => ({ status: 200, body: good, ms: ROUTER.gatewayLimitMs + 1 })), { valid: false, reason: "too slow", ms: ROUTER.gatewayLimitMs + 1, ...fixed });
});

test("a probe asks for an agent's input when it has one, and for the fixed input otherwise", async () => {
  const s = OFFICIAL_ROUTES["token-risk"];
  const good = { risk: { score: 12, level: "low", flags: [] } };
  const paths: string[] = [];
  const call = async (path: string) => (paths.push(path), { status: 200, body: good, ms: 300 });
  const inputs = { token: "0xabc", chain: "base" };
  assert.deepEqual((await probeApi(s, call, inputs)).real, { capability: "token-risk", inputs });
  assert.equal((await probeApi(s, call, null)).real, null);
  // Inputs the API's path can't be filled from: the fixed input, not a failed probe.
  const fallback = await probeApi(s, call, { chain: "base" });
  assert.deepEqual([fallback.valid, fallback.real], [true, null]);
  const fixedPath = `/risk/${PROBE_INPUTS["token-risk"].token}?chain=robinhood`;
  assert.deepEqual(paths, ["/risk/0xabc?chain=base", fixedPath, fixedPath]);
});

test("a probe and the format test tell \"not ready yet\" from a failure", async () => {
  const s = OFFICIAL_ROUTES["safe-swap"];
  const slow = async () => ({ status: 503, body: { error: "checks_slow" }, ms: 21_000, retryAfter: 60 });
  const probe = await probeApi(s, slow);
  assert.deepEqual([probe.valid, probe.notReady], [false, true]);
  const t = await formatTest(s, slow);
  assert.deepEqual([t.ok, t.wait], [false, 60]);
  assert.match(t.reason, /not ready yet: run the test again in 60 seconds/);
  // A 503 with no wait, or one that asks for ten minutes, is a failed probe.
  assert.equal((await probeApi(s, async () => ({ status: 503, body: null, ms: 300 }))).notReady, false);
  assert.equal((await probeApi(s, async () => ({ status: 503, body: null, ms: 300, retryAfter: 600 }))).notReady, false);
});

test("routing settings typed into a form are checked before they are saved", () => {
  const parse = (capability: string, path: string, mapping = "") => {
    const r = parseRouteSettings(capability, path, mapping);
    return r.ok ? r.settings : `refused: ${r.error}`;
  };
  assert.deepEqual(parse("token-price", " /price/{token}?chain={chain} "), { capability: "token-price", path: "/price/{token}?chain={chain}", mapping: null });
  assert.deepEqual(parse("token-price", "/p/{token}", '{"price_usd": "data.usd", "as_of": "ts"}'), { capability: "token-price", path: "/p/{token}", mapping: { price_usd: "data.usd", as_of: "ts" } });
  assert.deepEqual(parse("payment-check", "/payment/{tx_hash}", '{"from": "payments.0.from"}'), { capability: "payment-check", path: "/payment/{tx_hash}", mapping: { from: "payments.0.from" } });
  assert.match(String(parse("made-up", "/p")), /^refused/);
  assert.match(String(parse("token-price", "price/{token}")), /^refused/);
  assert.match(String(parse("token-price", "/p/{token}", "{not json")), /^refused/);
  assert.match(String(parse("token-price", "/p/{token}", '["price_usd"]')), /^refused/);
  assert.match(String(parse("token-price", "/p/{token}", '{"score": "x"}')), /^refused: score is not a field/);
  assert.match(String(parse("token-price", "/p/{token}", '{"price_usd": "a b"}')), /^refused/);
  assert.match(String(parse("token-price", "/p/{token}", '{"price_usd": 5}')), /^refused/);
});
