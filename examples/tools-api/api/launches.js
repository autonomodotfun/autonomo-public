// Official Autonomo API: the newest token launches on the Robinhood Chain launchpad.
//
// GET /v1/launches?limit=10   (header: x-api-key: <TOOLS_API_KEY>)
//
// Every launch on the launchpad emits one TokenCreated-style event from its factory, carrying the token, its
// bonding curve and the creator. For each of the newest launches this reads the token's name and supply, every
// buy and sell on its curve since launch, and the latest trade price. USD uses Chainlink's ETH/USD feed on Base.
// Everything comes straight from public chains, so every number can be checked on the explorer.

import { timingSafeEqual } from "node:crypto";
import { createPublicClient, defineChain, http, parseAbi, toHex } from "viem";
import { base } from "viem/chains";

const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"; // topics: token, curve, creator
const BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455"; // data: ethIn, tokensOut, fee, fee
const SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df"; // data: tokensIn, ethOut, fee, fee
const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const EXPLORER = "https://robinhoodchain.blockscout.com";

// The RPC allows at most 30,000 blocks per log query (about 50 minutes on Robinhood Chain).
const SPAN = 29_000n;
const MAX_WINDOWS = 12; // look back up to about 10 hours for enough launches

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});
const rh = createPublicClient({ chain: robinhood, transport: http() });
const bs = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined) });
const erc20 = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function totalSupply() view returns (uint256)"]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);

const CACHE_MS = 20_000;
const cache = new Map(); // limit -> { at, body }

function authorized(req) {
  const expected = process.env.TOOLS_API_KEY;
  if (!expected) return true; // local development without a key
  const given = Buffer.from(String(req.headers["x-api-key"] ?? ""));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

const getLogs = (filter) => rh.request({ method: "eth_getLogs", params: [filter] });
const words = (data) => data.slice(2).match(/.{64}/g).map((w) => BigInt(`0x${w}`));
const addr = (topic) => `0x${topic.slice(26)}`;

/** The newest `limit` launch events, newest first. */
async function newestLaunches(limit) {
  const latest = await rh.getBlockNumber();
  const found = [];
  let to = latest;
  for (let i = 0; i < MAX_WINDOWS && found.length < limit; i++) {
    const from = to > SPAN ? to - SPAN : 0n;
    const logs = await getLogs({ address: FACTORY, topics: [LAUNCHED], fromBlock: toHex(from), toBlock: toHex(to) });
    found.push(...logs.reverse());
    if (from === 0n) break;
    to = from - 1n;
  }
  return { latest, launches: found.slice(0, limit) };
}

async function ethUsd() {
  const [round, decimals] = await Promise.all([
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "latestRoundData" }),
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "decimals" }),
  ]);
  return Number(round[1]) / 10 ** decimals;
}

/** Name, supply and curve trading activity for one launch. */
async function describe(log, latest, ethPrice) {
  const token = addr(log.topics[1]);
  const curve = addr(log.topics[2]);
  const creator = addr(log.topics[3]);
  const launchBlock = BigInt(log.blockNumber);
  const graduationEth = Number(words(log.data)[2] ?? 0n) / 1e18;

  const [name, symbol, supply, block] = await Promise.all([
    rh.readContract({ address: token, abi: erc20, functionName: "name" }).catch(() => null),
    rh.readContract({ address: token, abi: erc20, functionName: "symbol" }).catch(() => null),
    rh.readContract({ address: token, abi: erc20, functionName: "totalSupply" }).catch(() => null),
    rh.getBlock({ blockNumber: launchBlock }),
  ]);

  // Trades on the curve since launch, in log-query-sized windows.
  const trades = [];
  for (let from = launchBlock; from <= latest; from += SPAN + 1n) {
    const to = from + SPAN > latest ? latest : from + SPAN;
    trades.push(...(await getLogs({ address: curve, topics: [[BUY, SELL]], fromBlock: toHex(from), toBlock: toHex(to) })));
  }
  let buys = 0, sells = 0, ethIn = 0n, ethOut = 0n;
  const buyers = new Set();
  for (const t of trades) {
    const w = words(t.data);
    if (t.topics[0] === BUY) {
      buys++;
      ethIn += w[0];
      buyers.add(t.topics[2]);
    } else {
      sells++;
      ethOut += w[1];
    }
  }

  let priceEth = null;
  const last = trades.at(-1);
  if (last) {
    const w = words(last.data);
    const [eth, tokens] = last.topics[0] === BUY ? [w[0], w[1]] : [w[1], w[0]];
    if (tokens > 0n) priceEth = Number(eth) / Number(tokens); // both have 18 decimals
  }
  const supplyTokens = supply === null ? null : Number(supply) / 1e18;
  const priceUsd = priceEth === null ? null : priceEth * ethPrice;
  const netEth = Number(ethIn - ethOut) / 1e18;

  return {
    token,
    name,
    symbol,
    launchedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    ageMinutes: Math.max(0, Math.round((Date.now() / 1000 - Number(block.timestamp)) / 60)),
    creator,
    curve,
    trades: { buys, sells, uniqueBuyers: buyers.size, volumeEth: Number(ethIn + ethOut) / 1e18 },
    priceEth,
    priceUsd,
    marketCapUsd: priceUsd !== null && supplyTokens !== null ? priceUsd * supplyTokens : null,
    // Net ETH bought into the curve against the launch's graduation target (approximate: fees are ignored).
    curveProgress: graduationEth > 0 ? { netEth, targetEth: graduationEth, percent: Math.max(0, Math.min(100, (netEth / graduationEth) * 100)) } : null,
    explorer: `${EXPLORER}/token/${token}`,
    launchTx: log.transactionHash,
  };
}

async function feed(limit) {
  const [{ latest, launches }, ethPrice] = await Promise.all([newestLaunches(limit), ethUsd()]);
  const items = await Promise.all(launches.map((l) => describe(l, latest, ethPrice)));
  return {
    chain: "Robinhood Chain",
    launchpad: FACTORY,
    count: items.length,
    launches: items,
    ethUsd: ethPrice,
    source: "TokenCreated events from the launchpad factory and trades on each bonding curve (Robinhood Chain); ETH/USD from Chainlink on Base.",
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });

  const n = Number(req.query.limit ?? 10);
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 25) : 10;
  try {
    const hit = cache.get(limit);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.status(200).json(hit.body);
    const body = await feed(limit);
    cache.set(limit, { at: Date.now(), body });
    return res.status(200).json(body);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}
