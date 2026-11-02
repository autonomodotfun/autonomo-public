// Official Autonomo API: a rug-risk check for tokens launched on the Robinhood Chain launchpad.
//
// GET /v1/risk/<token address>   (header: x-api-key: <TOOLS_API_KEY>)
//
// Finds the token's launch event on the launchpad factory (creator, bonding curve, launch block), replays every
// transfer since launch to get current balances, and reads every curve trade plus, once the token has graduated,
// every swap in its Uniswap v4 pool. From that it reports holder concentration, what the creator and the
// launch-block buyers still hold, trading activity, price and curve progress,
// then turns those into plain-English flags and a low / medium / high score. Everything is read from the chain.
//
// This is a heuristic, not advice: a low score doesn't make a token safe.

import { timingSafeEqual } from "node:crypto";
import { createPublicClient, defineChain, http, isAddress, pad, parseAbi, toHex } from "viem";
import { base } from "viem/chains";
import { findPool } from "./_lib.js";

const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"; // topics: token, curve, creator
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455"; // data: ethIn, tokensOut, fee, fee
const SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df"; // data: tokensIn, ethOut, fee, fee
const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
// Graduated tokens move their liquidity from the curve into Uniswap v4, where the singleton PoolManager holds it.
// Like the curve, that's pool liquidity rather than a holder, so it's kept out of holder concentration.
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
// PonsV2LaunchLocker: at graduation the launchpad sends it the Uniswap v4 position and a fixed share of supply
// (4/49, about 8.16%). It has no withdraw function, so those tokens can never be sold: they're reported as locked
// and kept out of holder concentration and circulating supply, like burns.
const LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
const V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"; // data: amount0, amount1, sqrtPriceX96, …
const signed = (w) => (w >= 2n ** 255n ? w - 2n ** 256n : w);

// Log queries filtered by contract may span millions of blocks; the RPC caps results, so big ranges split in half.
const LOOKBACK = 9_000_000n; // about 13 days of launch history (~0.125 s blocks)
const BLOCKS_PER_DAY = 690_000n;

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});
const rh = createPublicClient({ chain: robinhood, transport: http() });
const bs = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined) });
const erc20 = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);

const CACHE_MS = 60_000;
const cache = new Map(); // token -> { at, status, body }
const launchCache = new Map(); // token -> launch log (launches never change)

function authorized(req) {
  const expected = process.env.TOOLS_API_KEY;
  if (!expected) return true; // local development without a key
  const given = Buffer.from(String(req.headers["x-api-key"] ?? ""));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

const getLogs = (filter) => rh.request({ method: "eth_getLogs", params: [filter] });
const words = (data) => data.slice(2).match(/.{64}/g).map((w) => BigInt(`0x${w}`));
const addr = (topic) => `0x${topic.slice(26)}`.toLowerCase();

/** All logs for a contract-filtered query over [from, to], splitting the range when the RPC says too many. */
async function logsBetween(filter, from, to) {
  try {
    return await getLogs({ ...filter, fromBlock: toHex(from), toBlock: toHex(to) });
  } catch (e) {
    const said = `${e.details ?? e.message}`;
    // Being rate limited isn't a range problem: splitting would only send more requests.
    if (e.status === 429 || /too many requests|rate.?limit/i.test(said)) throw e;
    if (to - from < 1000n || !/exceed|limit|too many|spans|allowed/i.test(said)) throw e;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([logsBetween(filter, from, mid), logsBetween(filter, mid + 1n, to)]);
    return [...a, ...b];
  }
}

/** Every buy and sell on the curve, oldest first. Queried as two single-event queries: the RPC caps "buy or sell"
 * queries at 100,000 blocks (dozens of split requests for a token a few days old, enough to time out), but allows
 * far larger ranges for one event type on one contract. */
async function curveTrades(curve, from, to) {
  const [buys, sells] = await Promise.all([
    logsBetween({ address: curve, topics: [BUY] }, from, to),
    logsBetween({ address: curve, topics: [SELL] }, from, to),
  ]);
  const order = (l) => BigInt(l.blockNumber) * 100_000n + BigInt(l.logIndex);
  return [...buys, ...sells].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

/** The factory's launch event for this token within the lookback window. */
async function findLaunch(token, latest) {
  if (launchCache.has(token)) return launchCache.get(token);
  const logs = await logsBetween({ address: FACTORY, topics: [LAUNCHED, pad(token)] }, latest > LOOKBACK ? latest - LOOKBACK : 0n, latest);
  const hit = logs[0] ?? null;
  if (hit) launchCache.set(token, hit);
  return hit;
}

async function ethUsd() {
  const [round, decimals] = await Promise.all([
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "latestRoundData" }),
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "decimals" }),
  ]);
  return Number(round[1]) / 10 ** decimals;
}

const pct = (part, whole) => (whole > 0n ? Number((part * 1_000_000n) / whole) / 10_000 : 0);

async function check(token) {
  const latest = await rh.getBlockNumber();
  const launch = await findLaunch(token, latest);
  if (!launch) {
    return {
      status: 404,
      body: { error: "not_found", message: "No launch found for this token on the Robinhood Chain launchpad in the last ~13 days." },
    };
  }
  const curve = addr(launch.topics[2]);
  const creator = addr(launch.topics[3]);
  const launchBlock = BigInt(launch.blockNumber);
  const graduationEth = Number(words(launch.data)[2] ?? 0n) / 1e18;

  // After graduation, trading moves to the launchpad's Uniswap v4 pool, so its swaps count as well.
  const pool = await findPool(token, latest, launchBlock);
  const [name, symbol, decimals, supply, launchedBlock, transfers, trades, swaps, ethPrice] = await Promise.all([
    rh.readContract({ address: token, abi: erc20, functionName: "name" }).catch(() => null),
    rh.readContract({ address: token, abi: erc20, functionName: "symbol" }).catch(() => null),
    rh.readContract({ address: token, abi: erc20, functionName: "decimals" }).catch(() => 18),
    rh.readContract({ address: token, abi: erc20, functionName: "totalSupply" }),
    rh.getBlock({ blockNumber: launchBlock }),
    logsBetween({ address: token, topics: [TRANSFER] }, launchBlock, latest),
    curveTrades(curve, launchBlock, latest),
    pool ? logsBetween({ address: POOL_MANAGER, topics: [V4_SWAP, pool.id] }, pool.block, latest) : [],
    ethUsd(),
  ]);

  // Current balances from every transfer since launch (exact). Buys are tokens leaving the curve; sells are the
  // higher of curve sell events and transfers back to the curve, since aggregators batch some sells.
  const balances = new Map();
  const buyers = new Set();
  let buys = 0, sells = 0, buys24h = 0, sells24h = 0;
  const dayAgo = latest - BLOCKS_PER_DAY;
  const curveAddr = addr(launch.topics[2]);
  for (const t of transfers) {
    const from = addr(t.topics[1]);
    const to = addr(t.topics[2]);
    const value = BigInt(t.data);
    if (from !== ZERO) balances.set(from, (balances.get(from) ?? 0n) - value);
    balances.set(to, (balances.get(to) ?? 0n) + value);
    const recent = BigInt(t.blockNumber) >= dayAgo;
    if (from === curveAddr && to !== ZERO && to !== POOL_MANAGER && to !== LOCKER) { buys++; buyers.add(to); if (recent) buys24h++; }
    else if (to === curveAddr && from !== ZERO) { sells++; if (recent) sells24h++; }
    else if (from === POOL_MANAGER && to !== ZERO && to !== LOCKER) buyers.add(to); // bought in the v4 pool
  }
  const inCurve = balances.get(curve) ?? 0n;
  const burned = (balances.get(DEAD) ?? 0n) + (balances.get(ZERO) ?? 0n);
  const inPool = balances.get(POOL_MANAGER) ?? 0n;
  const locked = balances.get(LOCKER) ?? 0n;
  const circulating = supply - inCurve - inPool - burned - locked;
  const holders = [...balances.entries()]
    .filter(([a, b]) => b > 0n && a !== curve && a !== POOL_MANAGER && a !== LOCKER && a !== DEAD && a !== ZERO)
    .sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
  const top10 = holders.slice(0, 10).reduce((s, [, b]) => s + b, 0n);
  const creatorHolds = balances.get(creator) ?? 0n;

  // Trades: activity, buyers, and the wallets that bought in the launch block (often bundled with the launch).
  // ETH volume, launch-block buyers and the creator's own trades come from the curve's trade events.
  let ethIn = 0n, ethOut = 0n, sellEvents = 0, sellEvents24h = 0;
  const launchBlockBuyers = new Set();
  let creatorBought = 0n, creatorSold = 0n;
  for (const t of trades) {
    const w = words(t.data);
    const who = addr(t.topics[2]);
    if (t.topics[0] === BUY) {
      ethIn += w[0];
      if (BigInt(t.blockNumber) === launchBlock) launchBlockBuyers.add(who);
      if (who === creator) creatorBought += w[1];
    } else {
      ethOut += w[1];
      sellEvents++;
      if (BigInt(t.blockNumber) >= dayAgo) sellEvents24h++;
      if (addr(t.topics[1]) === creator || who === creator) creatorSold += w[0];
    }
  }
  sells = Math.max(sells, sellEvents);
  sells24h = Math.max(sells24h, sellEvents24h);

  // Uniswap v4 swaps (amounts are from the swapper's side: negative ETH means they paid ETH in, i.e. a buy).
  let poolBuys = 0, poolSells = 0, poolBuys24h = 0, poolSells24h = 0, poolEth = 0n;
  for (const sw of swaps) {
    const eth = signed(words(sw.data)[0]);
    const recent = BigInt(sw.blockNumber) >= dayAgo;
    if (eth < 0n) { poolBuys++; if (recent) poolBuys24h++; } else { poolSells++; if (recent) poolSells24h++; }
    poolEth += eth < 0n ? -eth : eth;
  }
  const curveStats = { buys, sells, volumeEth: Number(ethIn + ethOut) / 1e18 };
  buys += poolBuys;
  sells += poolSells;
  buys24h += poolBuys24h;
  sells24h += poolSells24h;
  const bundleHolds = [...launchBlockBuyers].reduce((s, a) => s + (a === curve ? 0n : balances.get(a) ?? 0n), 0n);

  let priceEth = null;
  const last = trades.at(-1);
  const lastSwap = swaps.at(-1);
  if (lastSwap) {
    const sqrt = Number(words(lastSwap.data)[2]) / 2 ** 96;
    priceEth = 1 / (sqrt * sqrt); // currency0 is ETH, so the pool price is tokens per ETH
  } else if (last) {
    const w = words(last.data);
    const [eth, tokens] = last.topics[0] === BUY ? [w[0], w[1]] : [w[1], w[0]];
    if (tokens > 0n) priceEth = (Number(eth) / Number(tokens)) * 10 ** (Number(decimals) - 18);
  }
  const unit = 10 ** Number(decimals);
  const priceUsd = priceEth === null ? null : priceEth * ethPrice;
  const netEth = Number(ethIn - ethOut) / 1e18;

  // Plain-English flags and a simple score. Shares are of circulating supply (outside the curve, the v4 pool, the locker and burns).
  const flags = [];
  let score = 0;
  const flag = (points, text) => { score += points; flags.push({ severity: points >= 3 ? "high" : points >= 2 ? "medium" : "low", text }); };
  const largest = holders[0] ? pct(holders[0][1], circulating) : 0;
  const top10Share = pct(top10, circulating);
  const creatorShare = pct(creatorHolds, supply);
  const bundleShare = pct(bundleHolds, circulating);

  if (largest >= 30) flag(3, `One wallet holds ${largest.toFixed(1)}% of circulating supply`);
  else if (largest >= 15) flag(2, `The largest wallet holds ${largest.toFixed(1)}% of circulating supply`);
  if (top10Share >= 70) flag(3, `Top 10 wallets hold ${top10Share.toFixed(1)}% of circulating supply`);
  else if (top10Share >= 45) flag(2, `Top 10 wallets hold ${top10Share.toFixed(1)}% of circulating supply`);
  if (creatorShare >= 10) flag(3, `The creator still holds ${creatorShare.toFixed(1)}% of total supply`);
  else if (creatorShare >= 3) flag(1, `The creator holds ${creatorShare.toFixed(1)}% of total supply`);
  if (creatorSold > 0n && creatorBought > 0n && creatorSold * 2n >= creatorBought) flag(2, "The creator has sold at least half of what they bought");
  if (launchBlockBuyers.size > 0 && bundleShare >= 25) flag(3, `Wallets that bought in the launch block still hold ${bundleShare.toFixed(1)}% of circulating supply`);
  else if (launchBlockBuyers.size >= 3) flag(1, `${launchBlockBuyers.size} wallets bought in the launch block`);
  if (holders.length === 0) flag(2, "No wallet holds this token outside the curve");
  else if (holders.length < 20) flag(2, `Only ${holders.length} holders so far`);
  if (buyers.size >= 10 && holders.length < buyers.size * 0.25) {
    flag(2, `Most buyers already sold: ${holders.length} of ${buyers.size} still hold (often a sign of bot volume)`);
  }
  if (sells24h > buys24h * 1.5 && sells24h >= 10) flag(1, "More sells than buys in the last 24 hours");
  if (!flags.length) flags.push({ severity: "info", text: "No major red flags in holder or trading data" });
  const level = score >= 6 ? "high" : score >= 3 ? "medium" : "low";

  return {
    status: 200,
    body: {
      token,
      name,
      symbol,
      chain: "Robinhood Chain",
      risk: { level, score, flags },
      launch: {
        launchedAt: new Date(Number(launchedBlock.timestamp) * 1000).toISOString(),
        creator,
        curve,
        launchTx: launch.transactionHash,
      },
      holders: {
        count: holders.length,
        largestPercent: largest,
        top10Percent: top10Share,
        top: holders.slice(0, 5).map(([address, b]) => ({ address, percent: pct(b, circulating), tokens: Number(b) / unit })),
      },
      supply: {
        total: Number(supply) / unit,
        inCurvePercent: pct(inCurve, supply),
        inPoolPercent: pct(inPool, supply),
        burnedPercent: pct(burned, supply),
        lockedPercent: pct(locked, supply),
        lockedNote: locked > 0n ? "Held by the Pons launch locker, which every token receives a fixed share of at graduation and which can't withdraw it. It's a launchpad rule, not a choice by the team, and it isn't part of the liquidity pool." : null,
        creatorPercent: creatorShare,
        launchBlockBuyers: launchBlockBuyers.size,
        launchBlockBuyersPercent: bundleShare,
      },
      trading: {
        buys,
        sells,
        buys24h,
        sells24h,
        uniqueBuyers: buyers.size,
        stillHolding: holders.length,
        volumeEth: Number(ethIn + ethOut + poolEth) / 1e18,
        curve: curveStats,
        pool: pool ? { buys: poolBuys, sells: poolSells, volumeEth: Number(poolEth) / 1e18 } : null,
      },
      market: {
        priceEth,
        priceUsd,
        priceSource: lastSwap ? "uniswap-v4" : last ? "curve" : null,
        graduated: Boolean(pool),
        marketCapUsd: priceUsd === null ? null : (priceUsd * Number(supply)) / unit,
        curveProgress: graduationEth > 0 ? { netEth, targetEth: graduationEth, percent: Math.max(0, Math.min(100, (netEth / graduationEth) * 100)) } : null,
      },
      explorer: `${EXPLORER}/token/${token}`,
      note: "Heuristic from public on-chain data, not financial advice. A low score does not make a token safe.",
      updatedAt: new Date().toISOString(),
    },
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });

  const token = String(req.query.token ?? "").trim().toLowerCase();
  if (!isAddress(token)) {
    return res.status(400).json({ error: "bad_token", message: "Pass a token contract address: /v1/risk/0x…" });
  }
  try {
    const hit = cache.get(token);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.status(hit.status).json(hit.body);
    const result = await check(token);
    cache.set(token, { at: Date.now(), ...result });
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}
