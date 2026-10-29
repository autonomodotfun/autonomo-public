// Shared helpers for the Autonomo tools API (files starting with "_" are not deployed as routes on Vercel).

import { timingSafeEqual } from "node:crypto";
import { createPublicClient, defineChain, http, pad, parseAbi, toHex } from "viem";
import { base } from "viem/chains";

export const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"; // topics: token, curve, creator
export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455"; // data: ethIn, tokensOut, fee, fee
export const SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df"; // data: tokensIn, ethOut, fee, fee
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export const AUTONOMO = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
export const BLOCKS_PER_DAY = 690_000n; // ~0.125 s blocks
const LOOKBACK = 9_000_000n; // ~13 days of launch history

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});
export const rh = createPublicClient({ chain: robinhood, transport: http() });
const bs = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined) });

export const erc20 = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);

/** Callers send the gateway's key as x-api-key; without TOOLS_API_KEY set (local use) the API is open. */
export function authorized(req) {
  const expected = process.env.TOOLS_API_KEY;
  if (!expected) return true;
  const given = Buffer.from(String(req.headers["x-api-key"] ?? ""));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export const getLogs = (filter) => rh.request({ method: "eth_getLogs", params: [filter] });
export const words = (data) => (data.length > 2 ? data.slice(2).match(/.{64}/g).map((w) => BigInt(`0x${w}`)) : []);
export const addr = (topic) => `0x${topic.slice(26)}`.toLowerCase();
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** All logs for a filtered query over [from, to], halving the range when the RPC says it's too much. */
export async function logsBetween(filter, from, to) {
  try {
    return await getLogs({ ...filter, fromBlock: toHex(from), toBlock: toHex(to) });
  } catch (e) {
    if (to - from < 500n || !/exceed|limit|too many|spans|allowed/i.test(`${e.details ?? e.message}`)) throw e;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([logsBetween(filter, from, mid), logsBetween(filter, mid + 1n, to)]);
    return [...a, ...b];
  }
}

let ethCache = null;
export async function ethUsd() {
  if (ethCache && Date.now() - ethCache.at < 60_000) return ethCache.price;
  const [round, decimals] = await Promise.all([
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "latestRoundData" }),
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "decimals" }),
  ]);
  ethCache = { at: Date.now(), price: Number(round[1]) / 10 ** decimals };
  return ethCache.price;
}

const metaCache = new Map();
/** name, symbol, decimals of a token (null fields when the contract doesn't answer). */
export async function tokenMeta(token) {
  const key = token.toLowerCase();
  if (metaCache.has(key)) return metaCache.get(key);
  const read = (fn) => rh.readContract({ address: key, abi: erc20, functionName: fn }).catch(() => null);
  const [name, symbol, decimals] = await Promise.all([read("name"), read("symbol"), read("decimals")]);
  const meta = { name, symbol, decimals: decimals === null ? 18 : Number(decimals) };
  if (symbol !== null) metaCache.set(key, meta);
  return meta;
}

const launchCache = new Map();
/** The launchpad factory's launch event for a token, or null if it wasn't launched there recently. */
export async function findLaunch(token, latest) {
  const key = token.toLowerCase();
  if (launchCache.has(key)) return launchCache.get(key);
  const logs = await logsBetween({ address: FACTORY, topics: [LAUNCHED, pad(key)] }, latest > LOOKBACK ? latest - LOOKBACK : 0n, latest);
  const hit = logs[0] ? { curve: addr(logs[0].topics[2]), creator: addr(logs[0].topics[3]), block: BigInt(logs[0].blockNumber), tx: logs[0].transactionHash } : null;
  if (hit) launchCache.set(key, hit);
  return hit;
}

/** Price in ETH from the latest buy or sell on a curve since `fromBlock`.
 * Buys and sells are queried separately: the RPC caps "buy or sell" queries at 100,000 blocks, but allows far
 * larger ranges for a single event type on one contract. */
export async function curvePrice(curve, latest, fromBlock = 0n) {
  const from = fromBlock > 0n ? fromBlock : latest > LOOKBACK ? latest - LOOKBACK : 0n;
  const [buys, sells] = await Promise.all([
    logsBetween({ address: curve, topics: [BUY] }, from, latest),
    logsBetween({ address: curve, topics: [SELL] }, from, latest),
  ]);
  const order = (l) => BigInt(l.blockNumber) * 100_000n + BigInt(l.logIndex);
  const last = [buys.at(-1), sells.at(-1)].filter(Boolean).sort((a, b) => (order(a) > order(b) ? -1 : 1))[0];
  if (!last) return null;
  const w = words(last.data);
  const [eth, tokens] = last.topics[0] === BUY ? [w[0], w[1]] : [w[1], w[0]];
  const block = await rh.getBlock({ blockNumber: BigInt(last.blockNumber) });
  return {
    priceEth: tokens > 0n ? Number(eth) / Number(tokens) : null,
    side: last.topics[0] === BUY ? "buy" : "sell",
    time: new Date(Number(block.timestamp) * 1000).toISOString(),
    tx: last.transactionHash,
  };
}

export function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}
