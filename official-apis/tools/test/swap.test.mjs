// Offline tests for Safe Swap (api/swap.js): no network. KyberSwap and the chain are stubbed through fetch.
// Run from official-apis/tools: node --test test/

import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData } from "viem";
import {
  assessToken, build, buildSlippageBps, MAX_SLIPPAGE_BPS, NATIVE, normalizeToken, quote, readQuote, routerAbi, signQuote,
  swapTxProblem, verdictOf,
} from "../api/swap.js";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const TOKEN = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const TAKER = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const EXECUTOR = "0x8f10b468b06c6fd214b65f87778827f7d113f996";
const NOW = Date.UTC(2026, 10, 18, 12);

// ---------------------------------------------------------------- the verdict

const holders = (summary = {}, count = 500) => ({
  status: 200,
  body: {
    token: { holders: count },
    summary: { largestWalletPercent: 2, top10WalletsPercent: 12, linkedGroupsPercent: 0, snipersStillHoldPercent: 0, unknownContractsPercent: 5, ...summary },
  },
});
const dev = (supply = {}) => ({ status: 200, body: { creator: TAKER, supply: { boughtPercent: 0, soldPercent: 0, sentPercent: 0, ...supply } } });
const risk = (lvl = "low", launchedAt = "2026-11-01T00:00:00Z") => ({
  status: 200,
  body: { risk: { level: lvl, score: 1, flags: [{ severity: "info", text: "something" }] }, launch: { launchedAt } },
});
const codes = (a) => a.flags.map((f) => `${f.level}:${f.code}`);

test("a healthy token passes with no flags", () => {
  const a = assessToken({ holders: holders(), dev: dev(), risk: risk() }, NOW);
  assert.deepEqual(a.flags, []);
  assert.equal(verdictOf(a.flags), "ok");
});

test("each holder threshold cautions, then blocks", () => {
  assert.deepEqual(codes(assessToken({ holders: holders({ largestWalletPercent: 8 }), dev: dev(), risk: risk() }, NOW)), ["caution:whale"]);
  assert.deepEqual(codes(assessToken({ holders: holders({ largestWalletPercent: 15 }), dev: dev(), risk: risk() }, NOW)), ["block:whale"]);
  assert.deepEqual(codes(assessToken({ holders: holders({ top10WalletsPercent: 40 }), dev: dev(), risk: risk() }, NOW)), ["block:concentrated"]);
  assert.deepEqual(codes(assessToken({ holders: holders({ linkedGroupsPercent: 5 }), dev: dev(), risk: risk() }, NOW)), ["caution:linked_wallets"]);
  assert.deepEqual(codes(assessToken({ holders: holders({ snipersStillHoldPercent: 10 }), dev: dev(), risk: risk() }, NOW)), ["block:snipers"]);
});

test("unnamed contracts only ever caution, since smart wallets count there", () => {
  assert.deepEqual(codes(assessToken({ holders: holders({ unknownContractsPercent: 90 }), dev: dev(), risk: risk() }, NOW)), ["caution:unknown_contracts"]);
});

test("one caution keeps ok, two make caution, any block blocks", () => {
  assert.equal(verdictOf([{ level: "caution" }]), "ok");
  assert.equal(verdictOf([{ level: "caution" }, { level: "caution" }]), "caution");
  assert.equal(verdictOf([{ level: "caution" }, { level: "block" }]), "block");
});

test("the Risk Checker's score, the token's age, its holder count and what the creator moved", () => {
  assert.deepEqual(codes(assessToken({ holders: holders(), dev: dev(), risk: risk("high") }, NOW)), ["block:risk_high"]);
  assert.deepEqual(codes(assessToken({ holders: holders(), dev: dev(), risk: risk("medium") }, NOW)), ["caution:risk_medium"]);
  assert.deepEqual(codes(assessToken({ holders: holders(), dev: dev(), risk: risk("low", new Date(NOW - 10 * 60_000).toISOString()) }, NOW)), ["caution:very_new"]);
  assert.deepEqual(codes(assessToken({ holders: holders({}, 12), dev: dev(), risk: risk() }, NOW)), ["caution:few_holders"]);
  assert.deepEqual(codes(assessToken({ holders: holders(), dev: dev({ boughtPercent: 4, soldPercent: 1, sentPercent: 1 }), risk: risk() }, NOW)), ["caution:dev_moved_tokens"]);
  // Burning, locking or adding to the pool isn't moving tokens away.
  assert.deepEqual(codes(assessToken({ holders: holders(), dev: dev({ boughtPercent: 4, burnedPercent: 4 }), risk: risk() }, NOW)), []);
});

test("a token the checks can't read is never quoted blind", () => {
  const down = { status: 502, body: { error: "upstream_error" } };
  assert.equal(assessToken({ holders: down, dev: dev(), risk: risk() }, NOW).failed, "holders");
  assert.equal(assessToken({ holders: holders(), dev: { status: 503, body: {} }, risk: risk() }, NOW).failed, "dev");
  assert.equal(assessToken({ holders: holders(), dev: dev(), risk: down }, NOW).failed, "risk");
  assert.equal(assessToken({ holders: { status: 404, body: { error: "not_found" } }, dev: dev(), risk: risk() }, NOW).notFound, true);
  // A Dev Wallet 404 from failed reads, not a missing creator, is a failure too.
  assert.equal(assessToken({ holders: holders(), dev: { status: 404, body: { error: "not_found" } }, risk: risk() }, NOW).failed, "dev");
  // A launchpad token (the creator came from its launch event) that the Risk Checker couldn't find: its search failed.
  const launchpadDev = { status: 200, body: { creator: { foundFrom: "launchpad launch event" }, supply: {} } };
  assert.equal(assessToken({ holders: holders(), dev: launchpadDev, risk: { status: 404, body: { error: "not_found" } } }, NOW).failed, "risk");
  // Not a launchpad token, or no creator found: shown, not fatal.
  const notLaunchpad = { status: 404, body: { error: "not_found" } };
  assert.deepEqual(codes(assessToken({ holders: holders(), dev: { status: 404, body: { error: "creator_not_found" } }, risk: notLaunchpad }, NOW)), [
    "caution:not_launchpad",
    "caution:creator_unknown",
  ]);
});

// ---------------------------------------------------------------- the signed quote

const aQuote = (over = {}) => ({
  tokenIn: USDG, tokenOut: TOKEN, amountIn: "1000000", taker: TAKER, minOut: "4800000000000000000000", slippageBps: 100,
  verdict: "ok", expires: Math.floor(NOW / 1000) + 60, ...over,
});

test("a quote_id reads back, expires, and can't be edited", () => {
  const id = signQuote(aQuote());
  assert.deepEqual(readQuote(id, NOW).quote, aQuote());
  assert.equal(readQuote(id, NOW + 61_000).error, "expired");
  const [payload, sig] = id.split(".");
  const forged = Buffer.from(JSON.stringify(aQuote({ verdict: "ok", minOut: "1" }))).toString("base64url");
  assert.equal(readQuote(`${forged}.${sig}`, NOW).error, "bad", "a changed quote with the old signature");
  assert.equal(readQuote(`${payload}.${sig.slice(0, -2)}AA`, NOW).error, "bad", "a changed signature");
  assert.equal(readQuote(payload, NOW).error, "bad");
  assert.equal(readQuote("", NOW).error, "bad");
});

// ---------------------------------------------------------------- checking KyberSwap's calldata

function swapData(over = {}, fn = "swap") {
  const desc = {
    srcToken: USDG, dstToken: TOKEN, srcReceivers: [EXECUTOR], srcAmounts: [1000000n], feeReceivers: [], feeAmounts: [],
    dstReceiver: TAKER, amount: 1000000n, minReturnAmount: 4800000000000000000000n, flags: 512n, permit: "0x", ...over,
  };
  if (fn === "swapSimpleMode") return encodeFunctionData({ abi: routerAbi, functionName: fn, args: [EXECUTOR, desc, "0x", "0x"] });
  return encodeFunctionData({ abi: routerAbi, functionName: fn, args: [{ callTarget: EXECUTOR, approveTarget: "0x0000000000000000000000000000000000000000", targetData: "0x", desc, clientData: "0x" }] });
}
const tx = (data, extra = {}) => ({ to: ROUTER, data, value: "0", ...extra });

test("an honest swap passes, in each of the router's forms", () => {
  assert.equal(swapTxProblem(tx(swapData()), aQuote()), null);
  assert.equal(swapTxProblem(tx(swapData({}, "swapSimpleMode")), aQuote()), null);
  assert.equal(swapTxProblem(tx(swapData({ minReturnAmount: 4900000000000000000000n })), aQuote()), null, "a higher minimum is fine");
});

test("every way the swap could differ from the quote is refused", () => {
  const q = aQuote();
  const cases = {
    "another router": [{ ...tx(swapData()), to: "0x2222222222222222222222222222222222222222" }, /router/],
    "not a router call": [tx("0xa9059cbb" + "00".repeat(64)), /can read/],
    "sells another token": [tx(swapData({ srcToken: TOKEN })), /sells a different token/],
    "buys another token": [tx(swapData({ dstToken: USDG })), /buys a different token/],
    "sells more": [tx(swapData({ amount: 2000000n, srcAmounts: [2000000n] })), /different amount/],
    "parts that don't line up": [tx(swapData({ srcAmounts: [1000000n, 1n] })), /line up/],
    "spends past the amount": [tx(swapData({ srcReceivers: [EXECUTOR, EXECUTOR], srcAmounts: [1000000n, 1n] })), /add up/],
    "spends less than the amount": [tx(swapData({ srcAmounts: [999999n] })), /add up/],
    "unchecked router flags": [tx(swapData({ flags: 513n })), /flags/],
    "a hex value": [tx(swapData(), { value: "zz" }), /can read/],
    "pays someone else": [tx(swapData({ dstReceiver: "0x3333333333333333333333333333333333333333" })), /taker/],
    "lower minimum": [tx(swapData({ minReturnAmount: 1n })), /minimum/],
    "a fee": [tx(swapData({ feeReceivers: ["0x3333333333333333333333333333333333333333"], feeAmounts: [1n] })), /fee/],
    "a permit": [tx(swapData({ permit: "0x1234" })), /permit/],
    "ETH attached": [tx(swapData(), { value: "1" }), /ETH/],
  };
  for (const [name, [t, why]] of Object.entries(cases)) assert.match(swapTxProblem(t, q) ?? "passed", why, name);
});

test("selling ETH must attach exactly the amount", () => {
  const q = aQuote({ tokenIn: NATIVE, amountIn: "500000000000000" });
  const data = swapData({ srcToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", amount: 500000000000000n, srcAmounts: [500000000000000n] });
  assert.equal(swapTxProblem(tx(data, { value: "500000000000000" }), q), null);
  assert.match(swapTxProblem(tx(data), q), /ETH/);
  // What KyberSwap really sends for ETH in: no parts, the ETH itself as msg.value.
  const noParts = swapData({ srcToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", amount: 500000000000000n, srcReceivers: [], srcAmounts: [] });
  assert.equal(swapTxProblem(tx(noParts, { value: "500000000000000" }), q), null);
});

test("the build slippage never lowers the quoted minimum, and is capped", () => {
  for (const [fresh, min] of [[1000n, 990n], [4890703884012608290816n, 4841796845172482207907n], [123457n, 120000n], [999n, 998n]]) {
    const bps = buildSlippageBps(fresh, min);
    assert.ok((fresh * BigInt(10_000 - bps)) / 10_000n >= min, `${fresh} ${min}`);
  }
  assert.equal(buildSlippageBps(1000n, 1001n), null, "price moved past the limit");
  assert.equal(buildSlippageBps(1000n, 1n), MAX_SLIPPAGE_BPS);
});

test("ETH and addresses are read, anything else isn't", () => {
  assert.equal(normalizeToken("ETH"), NATIVE);
  assert.equal(normalizeToken(" 0xE83C85E1eaD16FCFe85401E2b337Fb4FB5B5cC96 "), TOKEN);
  assert.equal(normalizeToken("autonomo"), null);
});

// ---------------------------------------------------------------- quote and build, with KyberSwap and the chain stubbed

function stub({ out = 4890703884012608290816n, back = 980000n, built = {}, balance = 10n ** 30n, allowance = 0n, routeError, shave = 0n, builds = [] } = {}) {
  const calls = [];
  const word = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push(u.pathname);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.hostname === "aggregator-api.kyberswap.com") {
      if (u.pathname.endsWith("/routes")) {
        if (routeError) return json({ code: 4008, message: routeError }, 400);
        const selling = u.searchParams.get("tokenIn").toLowerCase() === TOKEN;
        const amountOut = selling ? back : out;
        return json({ code: 0, data: { routerAddress: ROUTER, routeSummary: { amountIn: u.searchParams.get("amountIn"), amountOut: String(amountOut), amountInUsd: "1", amountOutUsd: "0.97" } } });
      }
      const req = JSON.parse(init.body);
      // Like KyberSwap, the build can price the route a little lower and take the slippage off that.
      const priced = BigInt(req.routeSummary.amountOut) - shave;
      builds.push(req.slippageTolerance);
      const min = (priced * BigInt(10_000 - req.slippageTolerance)) / 10_000n;
      return json({ code: 0, data: { routerAddress: ROUTER, amountOut: String(priced), transactionValue: "0", gas: "450000", data: swapData({ minReturnAmount: min }), ...built } });
    }
    // The chain: balanceOf and allowance as eth_call, through viem's batched JSON-RPC.
    const body = JSON.parse(init.body);
    const answer = (r) => {
      const data = r.params?.[0]?.data ?? "";
      if (r.method === "eth_call") return { jsonrpc: "2.0", id: r.id, result: word(data.startsWith("0xdd62ed3e") ? allowance : balance) };
      if (r.method === "eth_getBalance") return { jsonrpc: "2.0", id: r.id, result: `0x${balance.toString(16)}` };
      return { jsonrpc: "2.0", id: r.id, result: "0x1" };
    };
    return json(Array.isArray(body) ? body.map(answer) : answer(body));
  };
  return calls;
}

test("selling to USDG is quoted without token checks, then built with an exact approval", async () => {
  stub({ back: 199000n });
  const q = await quote({ token_in: TOKEN, token_out: USDG, amount_in: "1000000000000000000000", taker: TAKER }, NOW);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.verdict, "ok");
  assert.equal(q.body.min_out, String((199000n * 9900n) / 10_000n));
  assert.ok(q.body.selling_note);

  stub({ back: 199000n });
  globalThis.fetch = ((inner) => async (url, init) => {
    // The build's KyberSwap answer for this sell, with its own calldata.
    if (String(url).endsWith("/route/build")) {
      const req = JSON.parse(init.body);
      const min = (BigInt(req.routeSummary.amountOut) * BigInt(10_000 - req.slippageTolerance)) / 10_000n;
      const data = swapData({ srcToken: TOKEN, dstToken: USDG, amount: 10n ** 21n, srcAmounts: [10n ** 21n], minReturnAmount: min });
      return new Response(JSON.stringify({ code: 0, data: { routerAddress: ROUTER, amountOut: "199000", transactionValue: "0", data } }));
    }
    return inner(url, init);
  })(globalThis.fetch);
  const b = await build(q.body.quote_id, NOW + 5000);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.transactions.length, 2);
  const [approve, swap] = b.body.transactions;
  assert.equal(approve.to, TOKEN);
  assert.equal(approve.data, `0x095ea7b3${ROUTER.slice(2).padStart(64, "0")}${(10n ** 21n).toString(16).padStart(64, "0")}`);
  assert.equal(swap.to, ROUTER);
  assert.equal(b.body.simulated, false);
  assert.ok(BigInt(b.body.min_out) >= BigInt(q.body.min_out));
  assert.equal(b.body.deadline, Math.floor(NOW / 1000) + 5 + 120);
});

test("no route is a 404, so the caller isn't charged", async () => {
  stub({ routeError: "route not found" });
  const q = await quote({ token_in: TOKEN, token_out: USDG, amount_in: "1000", taker: TAKER }, NOW);
  assert.equal(q.status, 404);
  assert.equal(q.body.error, "no_route");
});

test("bad inputs are refused before anything is asked", async () => {
  const calls = stub();
  for (const query of [
    { token_in: "usd", token_out: USDG, amount_in: "1", taker: TAKER },
    { token_in: USDG, token_out: USDG, amount_in: "1", taker: TAKER },
    { token_in: TOKEN, token_out: USDG, amount_in: "0", taker: TAKER },
    { token_in: TOKEN, token_out: USDG, amount_in: "1.5", taker: TAKER },
    { token_in: TOKEN, token_out: USDG, amount_in: "1", taker: "me" },
    { token_in: TOKEN, token_out: USDG, amount_in: "1", taker: TAKER, slippage_bps: "-1" },
    // Takers that can't be the agent's own wallet.
    { token_in: "ETH", token_out: USDG, amount_in: "1", taker: "0x0000000000000000000000000000000000000000" },
    { token_in: TOKEN, token_out: USDG, amount_in: "1", taker: "0x000000000000000000000000000000000000dEaD" },
    { token_in: TOKEN, token_out: USDG, amount_in: "1", taker: TOKEN },
    { token_in: TOKEN, token_out: USDG, amount_in: "1", taker: ROUTER },
  ]) assert.equal((await quote(query, NOW)).status, 400, JSON.stringify(query));
  assert.equal(calls.length, 0);
});

test("slippage is capped at 5%", async () => {
  stub({ back: 1_000_000n });
  const q = await quote({ token_in: TOKEN, token_out: USDG, amount_in: "1000", taker: TAKER, slippage_bps: "5000" }, NOW);
  assert.equal(q.body.slippage_bps, 500);
  assert.equal(q.body.min_out, "950000");
});

test("build refuses blocked, expired, forged and moved quotes, and a short balance", async () => {
  stub();
  assert.equal((await build(signQuote(aQuote({ verdict: "block" })), NOW)).status, 403);
  assert.equal((await build(signQuote(aQuote()), NOW + 61_000)).status, 410);
  assert.equal((await build("abc.def", NOW)).status, 400);
  stub({ out: 4000000000000000000000n }); // price fell below the quoted minimum
  assert.equal((await build(signQuote(aQuote()), NOW)).body.error, "price_moved");
  stub({ balance: 10n });
  assert.equal((await build(signQuote(aQuote()), NOW)).body.error, "balance_too_low");
});

test("a build whose calldata doesn't match the quote returns nothing", async () => {
  stub({ built: { data: swapData({ dstReceiver: "0x3333333333333333333333333333333333333333" }) } });
  const b = await build(signQuote(aQuote()), NOW);
  assert.equal(b.status, 502);
  assert.equal(b.body.error, "unexpected_swap");
  assert.equal(b.body.transactions, undefined);
});

test("with the approval in place, only the swap comes back, simulated", async () => {
  stub({ allowance: 10n ** 30n });
  const b = await build(signQuote(aQuote()), NOW);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.transactions.length, 1);
  assert.equal(b.body.simulated, true);
});

test("every transaction names its sender and chain, and min_out is the one in the calldata", async () => {
  stub({ built: { data: swapData({ minReturnAmount: 4855555555555555555555n }) } });
  const b = await build(signQuote(aQuote()), NOW);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  for (const t of b.body.transactions) {
    assert.equal(t.from, TAKER);
    assert.equal(t.chainId, 4663);
  }
  assert.equal(b.body.min_out, "4855555555555555555555");
});

test("a swap to another router than the one approved is refused", async () => {
  process.env.SWAP_ROUTERS = `${ROUTER},0x2222222222222222222222222222222222222222`;
  try {
    stub({ built: { routerAddress: "0x2222222222222222222222222222222222222222" } });
    const b = await build(signQuote(aQuote()), NOW);
    assert.equal(b.status, 502);
    assert.match(b.body.message, /different router/);
  } finally {
    delete process.env.SWAP_ROUTERS;
  }
});

// Buying TOKEN with healthy reports, and the route back answering as given.
async function buyWithRouteBack(back) {
  stub();
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/routes") && u.searchParams.get("tokenIn").toLowerCase() === TOKEN) return back();
    return base(url, init);
  };
  const healthy = async () => ({ holders: holders(), dev: dev(), risk: risk() });
  return quote({ token_in: USDG, token_out: TOKEN, amount_in: "1000000", taker: TAKER }, NOW, healthy);
}
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("buying a healthy token is ok, with the round trip measured", async () => {
  const r = await buyWithRouteBack(() => answer({ code: 0, data: { routerAddress: ROUTER, routeSummary: { amountOut: "960000" } } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.verdict, "ok");
  assert.equal(r.body.round_trip_loss_pct, 4);
});

test("a sell route that can't be checked fails the quote; one that doesn't exist blocks", async () => {
  for (const back of [() => answer("busy", 429), () => answer({}, 502), () => answer({ code: 0, data: { routeSummary: {} } })]) {
    const r = await buyWithRouteBack(back);
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.error, "checks_failed");
  }
  const none = await buyWithRouteBack(() => answer({ code: 4008, message: "route not found" }, 400));
  assert.equal(none.status, 200);
  assert.equal(none.body.verdict, "block");
  assert.ok(none.body.flags.some((f) => f.code === "no_sell_route"));
});

test("when KyberSwap's build prices a unit lower, it's built again so the quoted minimum holds", async () => {
  // Quoted at exactly the route's own 1%: the build's lower price would put the minimum a unit under.
  const out = 4890703884012608290816n;
  const q = aQuote({ minOut: String((out * 9900n) / 10_000n) });
  const builds = [];
  stub({ out, shave: 1n, builds });
  const b = await build(signQuote(q), NOW);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(builds.length, 2);
  assert.ok(builds[1] < builds[0]);
  assert.ok(BigInt(b.body.min_out) >= BigInt(q.minOut));
  // A build that falls short by more than any slippage left is a moved price, and nothing is returned.
  stub({ out, shave: out / 50n });
  const moved = await build(signQuote(q), NOW);
  assert.equal(moved.status, 409);
  assert.equal(moved.body.transactions, undefined);
});
