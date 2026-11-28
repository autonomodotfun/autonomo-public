// Official Autonomo API: Safe Swap. Check a token, then swap it, in two calls, on Robinhood Chain.
//
// GET  /v1/swap/quote?token_in=<address|ETH>&token_out=<address|ETH>&amount_in=<base units>&taker=<wallet>&slippage_bps=100
// GET  /v1/swap/build/<quote_id>       (or POST /v1/swap/build with {"quote_id": "..."})
//                                      (header: x-api-key: <TOOLS_API_KEY>)
//
// Quote: runs Holders & Bundles, Dev Wallet Tracker and the Risk Checker on the token being bought, asks the KyberSwap
// aggregator for the best route, asks for the route back to see that the token can be sold again and at what loss,
// and turns all of it into a verdict: ok, caution or block. The answer carries a quote_id, valid for 60 seconds.
// Build: unsigned transactions for that quote (an exact approval when one is missing, then the swap), with a minimum
// output and a 2-minute deadline that the router enforces on-chain. The agent signs and sends them itself.
//
// Autonomo never holds funds and never sees a key. Before handing back the swap, the calldata KyberSwap built is
// decoded and checked against the quote: the router is one we checked, the tokens and amount are the ones quoted,
// the tokens go to the taker, the minimum is at least the quoted one, and nobody takes a fee.
//
// The quote_id is the quote itself, signed: nothing is kept between the two calls, so any instance can build it and a
// verdict can't be forged. Selling is never blocked: leaving a risky token must always be possible.
//
// Method and thresholds from an advisor's Safe Swap plan (Nov 2026), ported from Python.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { decodeFunctionData, isAddress, parseAbi } from "viem";
import { authorized, rh, sendJson, USDG, WETH } from "./_lib.js";
import devHandler from "./dev.js";
import holdersHandler from "./holders.js";
import riskHandler from "./risk.js";

export const CHAIN_ID = 4663;
const KYBER = "https://aggregator-api.kyberswap.com/robinhood/api/v1";
const KYBER_CLIENT_ID = process.env.KYBER_CLIENT_ID?.trim() || "autonomo";
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // KyberSwap's address for ETH

// KyberSwap's MetaAggregationRouterV2 on Robinhood Chain: the router its API returns (checked Nov 18, 2026), a verified
// contract on Blockscout with over a million transactions, at the address KyberSwap uses on its other chains.
// SWAP_ROUTERS (comma-separated) replaces the list, for when KyberSwap moves to a new router after it's been checked.
const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const routers = () => {
  const set = String(process.env.SWAP_ROUTERS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter((a) => isAddress(a));
  return new Set(set.length ? set : [KYBER_ROUTER]);
};

// What we never run token checks on, since we only check what the agent is buying. SWAP_TRUSTED_TOKENS adds more.
const trusted = () =>
  new Set([NATIVE, USDG, WETH, ...String(process.env.SWAP_TRUSTED_TOKENS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter((a) => isAddress(a))]);

export const QUOTE_TTL_SEC = 60; // a quote_id can be built for 60 s
export const TX_DEADLINE_SEC = 120; // the swap reverts on-chain if mined later than this
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%
export const MAX_SLIPPAGE_BPS = 500; // 5% hard cap
const CHECKS_DEADLINE_MS = 21_000; // the gateway waits 25 s; past this the quote answers 503 instead of timing out
export const CHECKS_RETRY_SEC = 60; // sent as Retry-After with that 503, the same minute its message asks for

// Caution and block thresholds, in percent: a first proposal, to tune with real quotes.
export const T = {
  largestWallet: [8, 15],
  top10Wallets: [25, 40],
  linkedGroups: [5, 15],
  snipersStillHold: [3, 10],
  unknownContracts: [20, 40],
  priceImpact: [10, 25],
  roundTripLoss: [15, 35],
};
// Only ever a caution: EIP-7702 smart wallets look like contracts and push this number up on healthy tokens.
const CAUTION_ONLY = new Set(["unknownContracts"]);
const MIN_HOLDERS = 50;
const MIN_AGE_SEC = 3600;

const DISCLAIMER =
  "Checks are statistics from public on-chain data, not a guarantee and not financial advice. They don't catch every scam, for example a token that blocks selling later.";

// ---------------------------------------------------------------- verdict

export function level(value, key) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const [caution, block] = T[key];
  if (value >= block && !CAUTION_ONLY.has(key)) return "block";
  return value >= caution ? "caution" : null;
}

/** Any block flag blocks; two or more cautions make a caution; a single caution is shown but the verdict stays ok. */
export function verdictOf(flags) {
  if (flags.some((f) => f.level === "block")) return "block";
  return flags.filter((f) => f.level === "caution").length >= 2 ? "caution" : "ok";
}

const pct = (v) => `${Number(v).toFixed(1)}%`;

/**
 * Flags on the token being bought, from the three reports ({ status, body } each, as their handlers answer).
 * Returns { flags, reports } or { notFound } when the token doesn't exist on Robinhood Chain, or { failed } when a
 * check couldn't run: then nothing is quoted, since buying blind is what this API exists to prevent.
 */
export function assessToken({ holders, dev, risk }, now = Date.now()) {
  if (holders.status === 404 && holders.body?.error === "not_found") return { notFound: true };
  if (holders.status !== 200) return { failed: "holders" };
  // Dev Wallet Tracker answers 404 both when it found no creator (shown below) and when its reads failed (fatal).
  if (dev.status !== 200 && !(dev.status === 404 && dev.body?.error === "creator_not_found")) return { failed: "dev" };
  if (risk.status !== 200 && risk.status !== 404) return { failed: "risk" };
  // A launchpad token the Risk Checker couldn't find: its launch search failed, so the score is missing, not clean.
  if (risk.status === 404 && /launch event/i.test(dev.body?.creator?.foundFrom ?? "")) return { failed: "risk" };
  const flags = [];
  const flag = (lvl, code, message) => lvl && flags.push({ level: lvl, code, message });

  const s = holders.body.summary;
  flag(level(s.largestWalletPercent, "largestWallet"), "whale", `One wallet holds ${pct(s.largestWalletPercent)} of the supply.`);
  flag(level(s.top10WalletsPercent, "top10Wallets"), "concentrated", `The ten largest wallets hold ${pct(s.top10WalletsPercent)}.`);
  flag(level(s.linkedGroupsPercent, "linkedGroups"), "linked_wallets", `Wallets funded by the same source hold ${pct(s.linkedGroupsPercent)}: probably one person, not proven.`);
  flag(level(s.snipersStillHoldPercent, "snipersStillHold"), "snipers", `Wallets that bought in the first seconds still hold ${pct(s.snipersStillHoldPercent)}.`);
  flag(level(s.unknownContractsPercent, "unknownContracts"), "unknown_contracts", `Unnamed contracts hold ${pct(s.unknownContractsPercent)} (smart wallets count here too).`);
  const count = holders.body.token?.holders;
  if (Number.isFinite(count) && count < MIN_HOLDERS) flag("caution", "few_holders", `Only ${count} holders.`);

  if (risk.status === 200) {
    const r = risk.body.risk;
    if (r?.level === "high") flag("block", "risk_high", `The Risk Checker scores this token high risk: ${r.flags.map((f) => f.text).join("; ")}.`);
    else if (r?.level === "medium") flag("caution", "risk_medium", `The Risk Checker scores this token medium risk: ${r.flags.map((f) => f.text).join("; ")}.`);
    const launched = Date.parse(risk.body.launch?.launchedAt ?? "");
    if (Number.isFinite(launched) && now - launched < MIN_AGE_SEC * 1000) flag("caution", "very_new", "The token is less than an hour old.");
  } else {
    flag("caution", "not_launchpad", "Not a Robinhood Chain launchpad token, so the Risk Checker couldn't score it.");
  }

  if (dev.status === 200) {
    const d = dev.body.supply ?? {};
    const bought = d.boughtPercent ?? 0;
    const moved = (d.soldPercent ?? 0) + (d.sentPercent ?? 0); // burned, locked and pooled don't count
    if (bought >= 1 && moved >= 0.5 * bought) {
      flag("caution", "dev_moved_tokens", `The creator bought ${bought.toFixed(2)}% and sold or sent ${moved.toFixed(2)}% (see Dev Wallet Tracker for where it went).`);
    }
  } else {
    flag("caution", "creator_unknown", "Couldn't find who created this token.");
  }

  return {
    flags,
    reports: {
      holders: { count: count ?? null, ...s },
      dev: dev.status === 200 ? { creator: dev.body.creator ?? null, ...(dev.body.supply ?? {}) } : null,
      risk: risk.status === 200 ? { level: risk.body.risk?.level, score: risk.body.risk?.score, launchedAt: risk.body.launch?.launchedAt ?? null } : null,
    },
  };
}

// ---------------------------------------------------------------- the quote_id: the quote, signed

const secret = (() => {
  let local;
  return () => {
    const own = process.env.SWAP_QUOTE_SECRET?.trim();
    if (own) return own;
    if (process.env.TOOLS_API_KEY?.trim()) throw new Error("SWAP_QUOTE_SECRET isn't set");
    return (local ??= randomBytes(32)); // local use only: quotes then build on this process alone
  };
})();

const mac = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function signQuote(q) {
  const payload = Buffer.from(JSON.stringify(q)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** The quote a quote_id holds, or an error: "bad" for anything not signed by us, "expired" past its time. */
export function readQuote(id, now = Date.now()) {
  const [payload, sig, extra] = String(id ?? "").trim().split(".");
  if (!payload || !sig || extra !== undefined || payload.length > 2000) return { error: "bad" };
  const want = Buffer.from(mac(payload));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { error: "bad" };
  let q;
  try {
    q = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return { error: "bad" };
  }
  if (!(q?.expires > 0) || now / 1000 > q.expires) return { error: "expired" };
  return { quote: q };
}

// ---------------------------------------------------------------- KyberSwap

export class KyberError extends Error {}

async function kyber(path, { params, body } = {}) {
  const url = new URL(KYBER + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "x-client-id": KYBER_CLIENT_ID, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new Error(`KyberSwap didn't answer (${e.name})`);
  }
  const json = await res.json().catch(() => null);
  if (res.status >= 500 || res.status === 429 || !json) throw new Error(`KyberSwap answered ${res.status}`);
  if (json.code !== 0 || !json.data) throw new KyberError(json.message || `KyberSwap answered ${res.status}`);
  return json.data;
}

const route = (tokenIn, tokenOut, amountIn, taker) =>
  kyber("/routes", { params: { tokenIn, tokenOut, amountIn: amountIn.toString(), origin: taker } });

// ---------------------------------------------------------------- checking KyberSwap's calldata

export const routerAbi = parseAbi([
  "struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }",
  "struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }",
  "function swap(SwapExecutionParams execution) payable returns (uint256, uint256)",
  "function swapSimpleMode(address caller, SwapDescriptionV2 desc, bytes executorData, bytes clientData) returns (uint256, uint256)",
  "function swapGeneric(SwapExecutionParams execution) payable returns (uint256, uint256)",
]);

const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * What's wrong with the swap transaction KyberSwap built, against the quote, or null when it's what was quoted:
 * an allowed router, the quoted tokens and amount, everything to the taker, a minimum at least the quoted one, no fee
 * taken by anyone, no permit, and ETH attached only when ETH is sold, exactly the amount.
 */
const MIN_TOO_LOW = "its minimum is below the quoted one";

export function swapTxProblem(tx, q, allowed = routers()) {
  return checkSwapTx(tx, q, allowed).problem ?? null;
}

// The only flag KyberSwap's router calls carry today (checked Nov 18, 2026, on buys, sells, ETH in and ETH out).
// Anything else (partial fills, burns, extra ETH) is refused until it's been looked at.
const KNOWN_FLAGS = new Set([0x200n]);

/** { problem } when the swap isn't what was quoted, otherwise { minReturn, value }, read from the calldata itself. */
export function checkSwapTx({ to, data, value }, q, allowed = routers()) {
  if (!allowed.has(String(to ?? "").toLowerCase())) return { problem: `router ${to} isn't one we checked` };
  let call;
  let attached;
  try {
    call = decodeFunctionData({ abi: routerAbi, data });
    attached = BigInt(String(value ?? "0").trim() || "x");
  } catch {
    return { problem: "the swap isn't a router call we can read" };
  }
  const problem = descProblem(call, attached, q);
  if (problem) return { problem };
  const d = call.functionName === "swapSimpleMode" ? call.args[1] : call.args[0].desc;
  return { minReturn: d.minReturnAmount, value: attached };
}

function descProblem(call, attached, q) {
  const d = call.functionName === "swapSimpleMode" ? call.args[1] : call.args[0].desc;
  if (!same(d.srcToken, q.tokenIn)) return "it sells a different token";
  if (!same(d.dstToken, q.tokenOut)) return "it buys a different token";
  if (d.amount !== BigInt(q.amountIn)) return "it sells a different amount";
  const ethIn = same(q.tokenIn, NATIVE);
  const split = d.srcAmounts.reduce((s, a) => s + a, 0n);
  // Selling a token, the parts must add up to the amount exactly. Selling ETH, KyberSwap sends no parts: msg.value is it.
  if (d.srcAmounts.length !== d.srcReceivers.length) return "its parts don't line up";
  if (ethIn ? d.srcAmounts.length > 0 && split !== d.amount : split !== d.amount) return "its parts don't add up to the amount";
  if (!KNOWN_FLAGS.has(d.flags)) return `it sets router flags we haven't checked (${d.flags})`;
  if (!same(d.dstReceiver, q.taker)) return "the tokens wouldn't go to the taker";
  if (d.minReturnAmount < BigInt(q.minOut)) return MIN_TOO_LOW;
  if (d.feeReceivers.length || d.feeAmounts.some((a) => a > 0n)) return "it pays a fee to someone";
  if (d.permit !== "0x") return "it carries a permit";
  if (attached !== (ethIn ? BigInt(q.amountIn) : 0n)) return "it attaches the wrong amount of ETH";
  return null;
}

/** The slippage to ask KyberSwap for at build time, so the minimum it enforces on the fresh price is never below
 * the minimum promised in the quote. Rounded down, so the minimum rounds up. */
export function buildSlippageBps(freshOut, minOut) {
  if (freshOut <= 0n || freshOut < minOut) return null;
  const bps = ((freshOut - minOut) * 10_000n) / freshOut;
  return Number(bps > BigInt(MAX_SLIPPAGE_BPS) ? BigInt(MAX_SLIPPAGE_BPS) : bps);
}

// ---------------------------------------------------------------- the three checks, run in-process

/** Runs another official API's handler in this function and returns { status, body }, as a caller would get it. */
function ask(handler, token) {
  return new Promise((resolve, reject) => {
    let status = 200;
    const res = {
      setHeader() {},
      status(code) {
        status = code;
        return res;
      },
      json(body) {
        resolve({ status, body });
        return res;
      },
    };
    const req = { method: "GET", query: { token, chain: "robinhood", depth: "basic" }, headers: { "x-api-key": process.env.TOOLS_API_KEY ?? "" } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function runChecks(token) {
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(() => resolve(null), CHECKS_DEADLINE_MS)));
  try {
    const all = Promise.all([ask(holdersHandler, token), ask(devHandler, token), ask(riskHandler, token)]);
    const done = await Promise.race([all, late]);
    if (!done) return { late: true };
    const [holders, dev, risk] = done;
    return { holders, dev, risk };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- quote and build

const fail = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

const NOT_TAKERS = new Set([NATIVE, "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

export function normalizeToken(t) {
  const v = String(t ?? "").trim().toLowerCase();
  if (v === "eth" || v === NATIVE) return NATIVE;
  return isAddress(v) ? v : null;
}

export async function quote(query, now = Date.now(), checksFor = runChecks) {
  const tokenIn = normalizeToken(query.token_in);
  const tokenOut = normalizeToken(query.token_out);
  const taker = String(query.taker ?? "").trim().toLowerCase();
  const rawAmount = String(query.amount_in ?? "").trim();
  const rawSlippage = String(query.slippage_bps ?? DEFAULT_SLIPPAGE_BPS).trim();
  if (!tokenIn || !tokenOut) return fail(400, "bad_token", "token_in and token_out must be token addresses, or ETH.");
  if (tokenIn === tokenOut) return fail(400, "bad_token", "token_in and token_out are the same.");
  if (!isAddress(taker) || NOT_TAKERS.has(taker) || taker === tokenIn || taker === tokenOut || routers().has(taker)) {
    return fail(400, "bad_taker", "taker must be the wallet that will sign and send the swap, and receive what it buys.");
  }
  if (!/^[1-9]\d{0,77}$/.test(rawAmount)) return fail(400, "bad_amount", "amount_in must be a whole number above 0, in base units (1 USDG = 1000000).");
  if (!/^\d{1,5}$/.test(rawSlippage)) return fail(400, "bad_slippage", "slippage_bps must be a whole number of basis points (100 = 1%).");
  const amountIn = BigInt(rawAmount);
  const slippageBps = Math.min(Number(rawSlippage), MAX_SLIPPAGE_BPS);

  const buying = !trusted().has(tokenOut);
  // The checks take a while the first time; the route is asked for at the same time.
  const [checks, routed] = await Promise.all([
    buying ? checksFor(tokenOut) : null,
    route(tokenIn, tokenOut, amountIn, taker).then((r) => ({ r }), (e) => ({ e })),
  ]);
  if (checks?.late) {
    return {
      ...fail(503, "checks_slow", "The token checks are taking longer than usual. Try again in a minute: they'll be ready.", { retry_after_seconds: CHECKS_RETRY_SEC }),
      retryAfter: CHECKS_RETRY_SEC,
    };
  }
  const assessed = checks ? assessToken(checks, now) : { flags: [], reports: null };
  if (assessed.notFound) return fail(404, "not_found", "No token found at token_out on Robinhood Chain.");
  if (assessed.failed) return fail(503, "checks_failed", `The ${assessed.failed} check couldn't run right now, and a token isn't quoted unchecked. Try again shortly.`);
  if (routed.e instanceof KyberError) return fail(404, "no_route", `KyberSwap found no route for this swap: ${routed.e.message}.`);
  if (routed.e) throw routed.e;

  const r = routed.r;
  const rs = r.routeSummary;
  const expectedOut = BigInt(rs.amountOut);
  if (expectedOut <= 0n) return fail(404, "no_route", "KyberSwap found no route that returns anything.");
  const minOut = (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const flags = [...assessed.flags];
  const flag = (lvl, code, message) => lvl && flags.push({ level: lvl, code, message });

  // What the swap loses to price impact, tax and fees, from KyberSwap's dollar values when it has them.
  const inUsd = Number(rs.amountInUsd);
  const outUsd = Number(rs.amountOutUsd);
  const impact = inUsd > 0 && outUsd > 0 ? Math.max(0, (1 - outUsd / inUsd) * 100) : null;
  if (impact !== null) flag(level(impact, "priceImpact"), "price_impact", `You'd lose about ${impact.toFixed(1)}% to price impact, tax and fees.`);

  // Can what's bought be sold back, and at what loss?
  let roundTrip = null;
  if (buying) {
    try {
      const back = await route(tokenOut, tokenIn, expectedOut, taker);
      const backOut = BigInt(back?.routeSummary?.amountOut ?? "x"); // a malformed answer throws, and the quote fails
      roundTrip = Math.max(0, (1 - Number((backOut * 1_000_000n) / amountIn) / 1_000_000) * 100);
      flag(level(roundTrip, "roundTripLoss"), "round_trip", `Buying then selling right away would lose about ${roundTrip.toFixed(1)}% (tax, fees, price impact).`);
    } catch (e) {
      if (!(e instanceof KyberError)) {
        return fail(503, "checks_failed", "Couldn't check that this token can be sold back, and a token isn't quoted unchecked. Try again shortly.");
      }
      flag("block", "no_sell_route", "No route to sell this token back: you might not be able to get out.");
    }
  }

  const verdict = verdictOf(flags);
  const expires = Math.floor(now / 1000) + QUOTE_TTL_SEC;
  const q = { tokenIn, tokenOut, amountIn: amountIn.toString(), taker, minOut: minOut.toString(), slippageBps, verdict, expires };
  return {
    status: 200,
    body: {
      chain_id: CHAIN_ID,
      quote_id: signQuote(q),
      expires_at: expires,
      verdict,
      flags,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: q.amountIn,
      expected_out: expectedOut.toString(),
      min_out: q.minOut,
      slippage_bps: slippageBps,
      amount_in_usd: Number.isFinite(inUsd) ? inUsd : null,
      amount_out_usd: Number.isFinite(outUsd) ? outUsd : null,
      price_impact_pct: impact === null ? null : Number(impact.toFixed(2)),
      round_trip_loss_pct: roundTrip === null ? null : Number(roundTrip.toFixed(2)),
      router: String(r.routerAddress ?? "").toLowerCase(),
      next: verdict === "block" ? "Blocked: Autonomo won't build this swap. See flags." : `Build it within ${QUOTE_TTL_SEC} seconds: /swap/build/<quote_id>`,
      selling_note: trusted().has(tokenIn) ? null : "Selling is never blocked: getting out of a risky token must always be possible.",
      checks: assessed.reports,
      disclaimer: DISCLAIMER,
    },
  };
}

const allowanceAbi = parseAbi(["function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);

function approveTx(token, spender, amount) {
  const data = `0x095ea7b3${spender.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
  return { to: token, data, value: "0", note: `Approves exactly ${amount} (base units) for the swap router, never an unlimited amount. Send it first and wait for it to confirm.` };
}

export async function build(id, now = Date.now()) {
  const read = readQuote(id, now);
  if (read.error === "expired") return fail(410, "quote_expired", "This quote has expired. Ask for a new one: /swap/quote.");
  if (read.error) return fail(400, "bad_quote", "That isn't a quote_id from /swap/quote.");
  const q = read.quote;
  if (q.verdict === "block") return fail(403, "blocked", "The token checks blocked this swap, so Autonomo won't build it.");

  const amountIn = BigInt(q.amountIn);
  const minOut = BigInt(q.minOut);
  const ethIn = q.tokenIn === NATIVE;
  // A fresh route: KyberSwap's routes go stale in seconds. It must still meet the quoted minimum.
  let r;
  try {
    r = await route(q.tokenIn, q.tokenOut, amountIn, q.taker);
  } catch (e) {
    if (e instanceof KyberError) return fail(409, "no_route", `KyberSwap has no route for this swap any more: ${e.message}. Ask for a new quote.`);
    throw e;
  }
  const router = String(r.routerAddress ?? "").toLowerCase();
  if (!routers().has(router)) return fail(403, "router_not_allowed", `KyberSwap picked router ${router}, which we haven't checked, so nothing was built.`);
  const freshOut = BigInt(r.routeSummary.amountOut);
  const bps = buildSlippageBps(freshOut, minOut);
  if (bps === null) return fail(409, "price_moved", "The price moved past your slippage limit. Ask for a new quote.");

  const [balance, allowance] = await Promise.all([
    ethIn ? rh.getBalance({ address: q.taker }) : rh.readContract({ address: q.tokenIn, abi: allowanceAbi, functionName: "balanceOf", args: [q.taker] }),
    ethIn ? null : rh.readContract({ address: q.tokenIn, abi: allowanceAbi, functionName: "allowance", args: [q.taker, router] }),
  ]);
  if (balance < amountIn) return fail(400, "balance_too_low", `The taker holds ${balance} and the swap needs ${amountIn} (base units).`);
  const needsApprove = !ethIn && allowance < amountIn;

  const deadline = Math.floor(now / 1000) + TX_DEADLINE_SEC;
  const buildAt = (slippageTolerance) =>
    kyber("/route/build", {
      body: {
        routeSummary: r.routeSummary,
        sender: q.taker,
        recipient: q.taker,
        origin: q.taker,
        slippageTolerance,
        deadline,
        // The simulation would revert while the approval is missing, so it only runs when it can pass.
        enableGasEstimation: !needsApprove,
        source: "autonomo-safe-swap",
      },
    });
  const checkBuilt = (b) => {
    const swap = { to: String(b.routerAddress ?? "").toLowerCase(), data: b.data, value: b.transactionValue ?? "0" };
    // The swap must go to the router the route named, the one the approval is for.
    return { swap, checked: swap.to === router ? checkSwapTx(swap, q) : { problem: "it goes to a different router than the approval" } };
  };
  let b;
  let built;
  try {
    b = await buildAt(bps);
    built = checkBuilt(b);
    // KyberSwap prices the route again when it builds, often a unit or so lower, and takes the slippage off that. When
    // that puts its minimum under the quoted one, build once more with the slippage worked out from its own figure.
    const again = built.checked.problem === MIN_TOO_LOW ? buildSlippageBps(BigInt(b.amountOut ?? 0), minOut) : null;
    if (again !== null && again < bps) {
      b = await buildAt(again);
      built = checkBuilt(b);
    }
  } catch (e) {
    if (e instanceof KyberError) return fail(409, "build_failed", `KyberSwap couldn't build this swap: ${e.message}. Ask for a new quote.`);
    throw e;
  }
  const { swap, checked } = built;
  if (checked.problem === MIN_TOO_LOW) return fail(409, "price_moved", "The price moved past your slippage limit. Ask for a new quote.");
  if (checked.problem) return fail(502, "unexpected_swap", `The swap KyberSwap built doesn't match the quote (${checked.problem}), so nothing was returned.`);
  const sender = { from: q.taker, chainId: CHAIN_ID };

  const transactions = [];
  if (needsApprove) transactions.push({ ...sender, ...approveTx(q.tokenIn, router, amountIn) });
  transactions.push({ ...sender, to: swap.to, data: swap.data, value: checked.value.toString(), gas: /^\d+$/.test(String(b.gas ?? "")) ? String(b.gas) : null, note: "The swap. It reverts on-chain after the deadline or if it would return less than min_out." });
  return {
    status: 200,
    body: {
      chain_id: CHAIN_ID,
      transactions,
      send_in_order: true,
      token_in: q.tokenIn,
      token_out: q.tokenOut,
      amount_in: q.amountIn,
      expected_out: String(b.amountOut),
      min_out: checked.minReturn.toString(), // what the router enforces, read from the calldata
      quoted_min_out: q.minOut,
      deadline,
      verdict: q.verdict,
      simulated: !needsApprove,
      warning:
        "Check that 'to' is the router you expect before signing. Autonomo never asks for a key." +
        (needsApprove ? " The swap wasn't simulated because the approval is missing: send the approve first." : ""),
    },
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const step = String(req.query.step ?? "");
  // Deployed, quotes are signed with a secret of their own, never one the gateway also holds.
  if (process.env.TOOLS_API_KEY?.trim() && !process.env.SWAP_QUOTE_SECRET?.trim()) {
    return sendJson(res, 503, { error: "not_configured", message: "This API isn't set up yet." });
  }
  try {
    if (step === "quote") {
      if (!process.env.BLOCKSCOUT_KEY?.trim()) return sendJson(res, 503, { error: "not_configured", message: "This API isn't set up yet." });
      const r = await quote(req.query);
      // "Not ready yet": the standard header for it, which Autonomo's router reads so the wait isn't held against this API.
      if (r.retryAfter) res.setHeader("Retry-After", String(r.retryAfter));
      return sendJson(res, r.status, r.body);
    }
    if (step === "build") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const r = await build(req.query.quote ?? body.quote_id ?? body.quote);
      return sendJson(res, r.status, r.body);
    }
    return sendJson(res, 404, { error: "not_found", message: "Use /swap/quote or /swap/build/<quote_id>." });
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't reach KyberSwap or the chain right now. Try again." });
  }
}
