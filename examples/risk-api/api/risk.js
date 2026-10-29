// Official Autonomo API: a rug-risk check for tokens launched on the Robinhood Chain launchpad.
//
// GET /v1/risk/<token address>   (header: x-api-key: <RISK_API_KEY>)
//
// Finds the token's launch event on the launchpad factory (creator, bonding curve, launch block), replays every
// transfer since launch to get current balances, and reads every curve trade. From that it reports holder
// concentration, what the creator and the launch-block buyers still hold, trading activity and curve progress,
// then turns those into plain-English flags and a low / medium / high score. Everything is read from the chain.
//
// This is a heuristic, not advice: a low score doesn't make a token safe.

import { timingSafeEqual } from "node:crypto";
import { createPublicClient, defineChain, http, isAddress, pad, parseAbi, toHex } from "viem";
import { base } from "viem/chains";

const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"; // topics: token, curve, creator
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455"; // data: ethIn, tokensOut, fee, fee
const SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df"; // data: tokensIn, ethOut, fee, fee
const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

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
  const expected = process.env.RISK_API_KEY;
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
    if (to - from < 1000n || !/exceed|limit|too many|spans|allowed/i.test(`${e.details ?? e.message}`)) throw e;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([logsBetween(filter, from, mid), logsBetween(filter, mid + 1n, to)]);
    return [...a, ...b];
  }
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

  const [name, symbol, decimals, supply, launchedBlock, transfers, trades, ethPrice] = await Promise.all([
    rh.readContract({ address: token, abi: erc20, functionName: "name" }).catch(() => null),
    rh.readContract({ address: token, abi: erc20, functionName: "symbol" }).catch(() => null),
    rh.readContract({ address: token, abi: erc20, functionName: "decimals" }).catch(() => 18),
    rh.readContract({ address: token, abi: erc20, functionName: "totalSupply" }),
    rh.getBlock({ blockNumber: launchBlock }),
    logsBetween({ address: token, topics: [TRANSFER] }, launchBlock, latest),
    logsBetween({ address: curve, topics: [[BUY, SELL]] }, launchBlock, latest),
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
    if (from === curveAddr && to !== ZERO) { buys++; buyers.add(to); if (recent) buys24h++; }
    else if (to === curveAddr && from !== ZERO) { sells++; if (recent) sells24h++; }
  }
  const inCurve = balances.get(curve) ?? 0n;
  const burned = (balances.get(DEAD) ?? 0n) + (balances.get(ZERO) ?? 0n);
  const circulating = supply - inCurve - burned;
  const holders = [...balances.entries()]
    .filter(([a, b]) => b > 0n && a !== curve && a !== DEAD && a !== ZERO)
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
  const bundleHolds = [...launchBlockBuyers].reduce((s, a) => s + (a === curve ? 0n : balances.get(a) ?? 0n), 0n);

  let priceEth = null;
  const last = trades.at(-1);
  if (last) {
    const w = words(last.data);
    const [eth, tokens] = last.topics[0] === BUY ? [w[0], w[1]] : [w[1], w[0]];
    if (tokens > 0n) priceEth = (Number(eth) / Number(tokens)) * 10 ** (Number(decimals) - 18);
  }
  const unit = 10 ** Number(decimals);
  const priceUsd = priceEth === null ? null : priceEth * ethPrice;
  const netEth = Number(ethIn - ethOut) / 1e18;

  // Plain-English flags and a simple score. Shares are of circulating supply (outside the curve and burns).
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
        burnedPercent: pct(burned, supply),
        creatorPercent: creatorShare,
        launchBlockBuyers: launchBlockBuyers.size,
        launchBlockBuyersPercent: bundleShare,
      },
      trading: { buys, sells, buys24h, sells24h, uniqueBuyers: buyers.size, stillHolding: holders.length, volumeEth: Number(ethIn + ethOut) / 1e18 },
      market: {
        priceEth,
        priceUsd,
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
