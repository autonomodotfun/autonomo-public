// Shared helpers for the Autonomo tools API (files starting with "_" are not deployed as routes on Vercel).

import { timingSafeEqual } from "node:crypto";
import { createPublicClient, defineChain, http, pad, parseAbi, toEventSelector, toHex } from "viem";
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
const LOOKBACK = 9_000_000n; // ~13 days: how far back curve prices look when no launch block is known
// The launchpad's first launch is at block 27,027,321, so a launch search never needs to look earlier.
export const LAUNCHPAD_START = 27_000_000n;
// How far back launch searches look on the public RPC (~13 days), under its 10M-block cap for one contract's logs.
const SEARCH_SPAN = 9_000_000n;

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});
export const rh = createPublicClient({ chain: robinhood, transport: http() });
// Base: the ETH/USD feed, and the APIs that take chain=base. Reads are batched into multicalls, since a report reads
// dozens of balances and Base's public RPC limits how often it's asked.
const bs = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined), batch: { multicall: true } });

// The chains an API can read, picked with ?chain=. Left out, it's Robinhood Chain, exactly as before.
export const CHAINS = {
  robinhood: {
    key: "robinhood",
    id: 4663,
    name: "Robinhood Chain",
    client: rh,
    blockscout: "https://api.blockscout.com/4663",
    explorer: EXPLORER,
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951", // Uniswap v4: where graduated tokens trade
  },
  base: {
    key: "base",
    id: 8453,
    name: "Base",
    client: bs,
    blockscout: "https://api.blockscout.com/8453",
    explorer: "https://base.blockscout.com",
    poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b", // Uniswap v4 PoolManager on Base (verified on Blockscout)
  },
};

/** The chain a request asks for: robinhood (the default) or base. Null for anything else. */
export function chainOf(query) {
  const v = String(query?.chain ?? "").trim().toLowerCase();
  if (!v || v === "robinhood" || v === "robinhood-chain" || v === "4663") return CHAINS.robinhood;
  if (v === "base" || v === "8453") return CHAINS.base;
  return null;
}

export const badChain = { error: "bad_chain", message: "chain can be robinhood (the default) or base." };

/** Base reads a token's whole history in one request, which needs an RPC of our own (BASE_RPC_URL): the public one
 * refuses those. Without it, chain=base answers "not set up" instead of failing halfway through a report. */
export const chainReady = (chain) => chain !== CHAINS.base || Boolean(process.env.BASE_RPC_URL?.trim());
export const chainNotReady = { error: "not_configured", message: "Base isn't set up for this API yet." };

/** For a token Robinhood Chain doesn't know: whether it's a token on Base, so the 404 can say to add chain=base.
 * One read of its supply. Never throws, and stays quiet when Base isn't set up, since chain=base couldn't answer. */
export async function isBaseToken(token) {
  if (!chainReady(CHAINS.base)) return false;
  try {
    return (await bs.readContract({ address: token, abi: erc20, functionName: "totalSupply" })) > 0n;
  } catch {
    return false;
  }
}

/** A Robinhood Chain "not found" answer, pointing to chain=base when the token is there. */
export async function withBaseHint(result, token) {
  if (result.status !== 404 || result.body?.error !== "not_found" || !(await isBaseToken(token))) return result;
  return {
    ...result,
    body: { ...result.body, message: `${result.body.message} This token is on Base: add ?chain=base.`, hint: { chain: "base" } },
  };
}

// Launchpads on Base whose launch event names the creator, checked on Base's Blockscout (Nov 2026). The creator is
// read from the event in the token's creation transaction; tokens from anywhere else fall back to whoever sent it.
// `creator` is the event field that names them, always the second indexed topic, so launches by a wallet can be searched too.
export const BASE_LAUNCHPADS = [
  {
    name: "Clanker", factory: "0xe85a59c628f7d27878aceb4bf3b35733630083a9", token: "tokenAddress", creator: "tokenAdmin", // v4
    event: "TokenCreated(address,address,address,string,string,string,string,string,int24,address,bytes32,address,address,address,uint256,address[])",
  },
  {
    name: "Clanker", factory: "0x2a787b2362021cc3eea3c24c4748a6cd5b687382", token: "tokenAddress", creator: "creatorAdmin", // v3.1
    event: "TokenCreated(address,address,address,address,address,uint256,string,string,int24,string,uint256,uint256,uint8,address)",
  },
  {
    name: "Zora", factory: "0x777777751622c0d3258f214f9df38e35bf45baf3", token: "coin", creator: "payoutRecipient",
    event: "CoinCreatedV4(address,address,address,address,string,string,string,address,(address,address,uint24,int24,address),bytes32,string)",
  },
  {
    name: "Zora", factory: "0x777777751622c0d3258f214f9df38e35bf45baf3", token: "coin", creator: "payoutRecipient",
    event: "CreatorCoinCreated(address,address,address,address,string,string,string,address,(address,address,uint24,int24,address),bytes32,string)",
  },
].map((p) => ({ ...p, topic0: toEventSelector(p.event) }));

const word = (data, i) => (data ?? "0x").slice(2 + i * 64, 2 + (i + 1) * 64);

/** The token a launch log names: Clanker in its first indexed topic, Zora in the fifth word of its data. */
function launchedToken(p, log) {
  const raw = p.token === "tokenAddress" ? log.topics?.[1]?.slice(26) : word(log.data, 4).slice(24);
  return raw && raw.length === 40 ? `0x${raw}`.toLowerCase() : null;
}

/** Which Base launchpad made a token and who its creator is, from the raw logs of the transaction that minted it. */
export function baseLaunchFromLogs(token, logs) {
  for (const l of logs ?? []) {
    const p = BASE_LAUNCHPADS.find((x) => x.factory === String(l.address).toLowerCase() && x.topic0 === l.topics?.[0]);
    if (!p || launchedToken(p, l) !== token.toLowerCase()) continue;
    const creator = `0x${l.topics[2]?.slice(26) ?? ""}`.toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(creator)) return { launchpad: p.name, factory: p.factory, creator, tx: l.transactionHash ?? null };
  }
  return null;
}

/** Tokens a wallet launched on the Base launchpads above, read from the chain. Null when the search failed. */
export async function baseLaunchesBy(wallet) {
  const latest = await bs.getBlockNumber();
  try {
    const found = await Promise.all(
      BASE_LAUNCHPADS.map(async (p) => {
        const logs = await logsBetween({ address: p.factory, topics: [p.topic0, null, pad(wallet.toLowerCase())] }, 0n, latest, CHAINS.base);
        return logs.map((log) => ({ token: launchedToken(p, log), launchpad: p.name, tx: log.transactionHash }));
      }),
    );
    return found.flat().filter((l) => l.token);
  } catch {
    return null;
  }
}

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

export const getLogs = (filter, client = rh) => client.request({ method: "eth_getLogs", params: [filter] });
export const words = (data) => (data.length > 2 ? data.slice(2).match(/.{64}/g).map((w) => BigInt(`0x${w}`)) : []);
export const addr = (topic) => `0x${topic.slice(26)}`.toLowerCase();
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** All logs for a filtered query over [from, to], halving the range when the RPC says it's too much. */
export async function logsBetween(filter, from, to, chain = CHAINS.robinhood) {
  try {
    return await getLogs({ ...filter, fromBlock: toHex(from), toBlock: toHex(to) }, chain.client);
  } catch (e) {
    const said = `${e.details ?? e.message}`;
    // Being rate limited isn't a range problem: splitting would only send more requests.
    if (e.status === 429 || /too many requests|rate.?limit/i.test(said)) throw e;
    if (to - from < 500n || !/exceed|limit|too many|spans|allowed/i.test(said)) throw e;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([logsBetween(filter, from, mid, chain), logsBetween(filter, mid + 1n, to, chain)]);
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
export async function tokenMeta(token, chain = CHAINS.robinhood) {
  const address = token.toLowerCase();
  const key = chain === CHAINS.robinhood ? address : `${chain.id}:${address}`;
  if (metaCache.has(key)) return metaCache.get(key);
  const read = (fn) => chain.client.readContract({ address, abi: erc20, functionName: fn }).catch(() => null);
  const [name, symbol, decimals] = await Promise.all([read("name"), read("symbol"), read("decimals")]);
  const meta = { name, symbol, decimals: decimals === null ? 18 : Number(decimals) };
  if (symbol !== null) metaCache.set(key, meta);
  return meta;
}

const launchLogs = new Map();
const misses = new Map();
const MISS_MS = 60_000;

/** Whether launch searches cover the launchpad's whole history. Only with an RPC of our own (ROBINHOOD_RPC_URL, a
 * paid plan): checking an old token reads every transfer and trade since its launch, and the public RPC caps each
 * search at 10M blocks, so months of history become dozens of requests at once and get rate limited. */
export const fullHistory = () => Boolean(process.env.ROBINHOOD_RPC_URL?.trim());

/** Whether a launch of any age can be found: with an RPC of our own, or by asking Blockscout for the block. */
export const findsOldLaunches = () => fullHistory() || hasBlockscout();

/** The launchpad factory's launch log for a token, or null if it wasn't launched there (within ~13 days on the
 * public RPC when there's no Blockscout key either). With `recentOnly`, always just ~13 days, for callers that look up many tokens in one answer. */
export async function launchLog(token, latest, { recentOnly = false } = {}) {
  const key = token.toLowerCase();
  if (launchLogs.has(key)) return launchLogs.get(key);
  const whole = fullHistory() && !recentOnly;
  const missKey = `${key}:${whole}`;
  if (Date.now() - (misses.get(missKey) ?? 0) < MISS_MS) return null;

  const recent = latest > SEARCH_SPAN ? latest - SEARCH_SPAN : 0n;
  const from = whole ? LAUNCHPAD_START : recent > LAUNCHPAD_START ? recent : LAUNCHPAD_START;
  // Filtered by token, the search returns at most one log, so one request covers any range on a paid RPC.
  let [hit] = await logsBetween({ address: FACTORY, topics: [LAUNCHED, pad(key)] }, from, latest);
  // Older than the public RPC can search: Blockscout knows the block the token was created in, and the launch
  // event sits in that same block, so the search shrinks to one block.
  if (!hit && !whole && !recentOnly && hasBlockscout()) {
    const block = await creationBlock(key).catch(() => null);
    if (block !== null && block < from) {
      [hit] = await logsBetween({ address: FACTORY, topics: [LAUNCHED, pad(key)] }, block, block);
    }
  }

  if (hit) launchLogs.set(key, hit);
  else {
    if (misses.size > 5000) misses.clear();
    misses.set(missKey, Date.now());
  }
  return hit ?? null;
}

/** The launch of a token on the launchpad (creator, curve, block), or null if it wasn't launched there. */
export async function findLaunch(token, latest, options) {
  const log = await launchLog(token, latest, options);
  return log ? { curve: addr(log.topics[2]), creator: addr(log.topics[3]), block: BigInt(log.blockNumber), tx: log.transactionHash } : null;
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

// Graduated tokens leave their curve for a Uniswap v4 ETH pool whose hook was made by the launchpad factory.
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const V4_INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"; // topics: id, currency0, currency1
const V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"; // data: amount0, amount1, sqrtPriceX96, …
// The hook the factory graduates tokens into (it's baked into the factory's bytecode). Anyone can deploy a hook
// whose factory() returns the launchpad, so only this exact address counts.
const LAUNCHPAD_HOOK = 0xe5e702641ea86f4ae6cc3cdaed2b886f976be044n;
const signed = (w) => (w >= 2n ** 255n ? w - 2n ** 256n : w);

const poolCache = new Map();
/** The launchpad's ETH/token v4 pool for a graduated token, or null while it's still on its curve.
 * Look-alike pools for the same token (other hooks, no hook) are ignored, so they can't set the price. */
export async function findPool(token, latest, fromBlock) {
  const key = token.toLowerCase();
  const hit = poolCache.get(key);
  if (hit && (hit.pool || Date.now() - hit.at < 60_000)) return hit.pool;
  const inits = await logsBetween({ address: POOL_MANAGER, topics: [V4_INITIALIZE, null, pad("0x00"), pad(key)] }, fromBlock, latest);
  const init = inits.find((l) => words(l.data)[2] === LAUNCHPAD_HOOK); // data: fee, tickSpacing, hooks, …
  const pool = init ? { id: init.topics[1], block: BigInt(init.blockNumber) } : null;
  poolCache.set(key, { at: Date.now(), pool });
  return pool;
}

/** Price in ETH from the latest swap in a v4 ETH/token pool, searching back from the newest blocks. */
export async function poolPrice(pool, latest) {
  for (let span = 100_000n; ; span *= 4n) {
    const from = latest - span > pool.block ? latest - span : pool.block;
    const swaps = await logsBetween({ address: POOL_MANAGER, topics: [V4_SWAP, pool.id] }, from, latest);
    const last = swaps.at(-1);
    if (last) {
      const [amount0, , sqrtPriceX96] = words(last.data);
      const sqrt = Number(sqrtPriceX96) / 2 ** 96;
      const block = await rh.getBlock({ blockNumber: BigInt(last.blockNumber) });
      return {
        priceEth: 1 / (sqrt * sqrt), // currency0 is ETH, so the pool price is tokens per ETH
        side: signed(amount0) < 0n ? "buy" : "sell", // the swapper paid ETH in
        time: new Date(Number(block.timestamp) * 1000).toISOString(),
        tx: last.transactionHash,
        venue: "uniswap-v4",
      };
    }
    if (from === pool.block) return null;
  }
}

/** Price in ETH of a launchpad token: its v4 pool once it has graduated, otherwise its curve. */
export async function launchPrice(token, launch, latest) {
  const pool = await findPool(token, latest, launch.block);
  if (pool) {
    const last = await poolPrice(pool, latest);
    if (last) return last;
  }
  const last = await curvePrice(launch.curve, latest, launch.block);
  return last && { ...last, venue: "curve" };
}

// ---- Blockscout PRO API: a wallet's whole history, which the RPC can't give. Used by Dev Wallet Tracker and
// Holders & Bundles. BLOCKSCOUT_KEY is its own key; BLOCKSCOUT_RPS is how many requests a second the plan allows
// (the Builder plan takes 15, so the default leaves a little room).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 1000 / Math.max(1, Number(process.env.BLOCKSCOUT_RPS) || 13);
let queue = Promise.resolve();
let lastSent = 0;
/** Requests start one gap apart and then run side by side, so a burst never passes the plan's limit. */
function turn() {
  queue = queue.then(async () => {
    const wait = lastSent + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastSent = Date.now();
  });
  return queue;
}

export const hasBlockscout = () => Boolean(process.env.BLOCKSCOUT_KEY?.trim());

/** One Blockscout request on a chain (Robinhood Chain unless given); null for a 404. The key rides in the query,
 * so errors never carry the URL. Both chains share one key and one rate limit. */
export async function blockscout(path, params = {}, chain = CHAINS.robinhood) {
  const url = new URL(chain.blockscout + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("apikey", process.env.BLOCKSCOUT_KEY.trim());
  for (let attempt = 0; attempt < 4; attempt++) {
    await turn();
    let res;
    try {
      // Blockscout turns away some default client names, so this sends the one its docs are tested with.
      res = await fetch(url, { headers: { "user-agent": "curl/8.5.0", accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    } catch {
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      await sleep(300 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Blockscout answered ${res.status} for ${path}`);
    return res.json();
  }
  throw new Error(`Blockscout didn't answer for ${path}`);
}

/** The block a contract was created in, or null when Blockscout doesn't know. */
async function creationBlock(address) {
  const about = await blockscout(`/api/v2/addresses/${address}`);
  const hash = about?.creation_transaction_hash ?? about?.creation_tx_hash;
  if (!hash) return null;
  const tx = await blockscout(`/api/v2/transactions/${hash}`);
  return tx?.block_number ? BigInt(tx.block_number) : null;
}

const names = new Map();
/** The verified name of a contract ("PoolManager"), or null for a wallet or an unnamed contract. Never throws. */
export async function contractName(address, chain = CHAINS.robinhood) {
  const address_ = address.toLowerCase();
  const key = chain === CHAINS.robinhood ? address_ : `${chain.id}:${address_}`;
  if (names.has(key)) return names.get(key);
  if (!hasBlockscout()) return null;
  try {
    const about = await blockscout(`/api/v2/addresses/${address_}`, {}, chain);
    const name = about?.is_contract && about.name ? String(about.name).slice(0, 60) : null;
    if (names.size > 20_000) names.clear();
    names.set(key, name);
    return name;
  } catch {
    return null;
  }
}

/** An Etherscan-style list (tokentx, txlist, txlistinternal), oldest first. Empty comes back as a message, not a list. */
export async function blockscoutList(action, params, chain = CHAINS.robinhood) {
  const r = await blockscout("/api", { module: "account", action, sort: "asc", ...params }, chain);
  return Array.isArray(r?.result) ? r.result : [];
}

/** The earliest log matching a filter in [from, to], or null. Halves the range when the RPC says it holds too many
 * logs and looks at the later half only when the earlier one is empty, so a busy contract costs a few dozen requests at most. */
export async function firstLog(filter, from, to, chain, budget = { left: 60 }) {
  if (budget.left-- <= 0) throw new Error("first log search ran out of requests");
  try {
    const logs = await getLogs({ ...filter, fromBlock: toHex(from), toBlock: toHex(to) }, chain.client);
    return logs[0] ?? null;
  } catch (e) {
    const said = `${e.details ?? e.message}`;
    if (e.status === 429 || /too many requests|rate.?limit/i.test(said)) throw e;
    if (to - from < 500n || !/exceed|limit|too many|spans|allowed/i.test(said)) throw e;
    const mid = from + (to - from) / 2n;
    return (await firstLog(filter, from, mid, chain, budget)) ?? firstLog(filter, mid + 1n, to, chain, budget);
  }
}

const origins = new Map();
/** Where a Base token came from: its first mint (block, time, transaction, who sent it, who got the supply) and,
 * when one of the known launchpads made it, which one and its creator. Null when the token was never minted. */
export async function baseOrigin(token) {
  const key = token.toLowerCase();
  const latest = await bs.getBlockNumber();
  if (origins.has(key)) return { ...origins.get(key), latest };
  const mint = await firstLog({ address: key, topics: [TRANSFER, pad("0x0")] }, 0n, latest, CHAINS.base);
  if (!mint) return null;
  const hash = mint.transactionHash;
  const [receipt, tx] = await Promise.all([bs.getTransactionReceipt({ hash }), bs.getTransaction({ hash })]);
  const origin = {
    block: BigInt(mint.blockNumber),
    time: mint.blockTimestamp ? Number(mint.blockTimestamp) : null,
    tx: hash,
    sender: tx.from.toLowerCase(),
    mintedTo: addr(mint.topics[2]),
    launch: baseLaunchFromLogs(key, receipt.logs),
  };
  if (origins.size > 5000) origins.clear();
  origins.set(key, origin);
  return { ...origin, latest };
}

/** A Transfer log as an Etherscan-style row, the shape the Blockscout lists use. */
export const transferRow = (l) => ({
  from: addr(l.topics[1]),
  to: addr(l.topics[2]),
  value: BigInt(l.data === "0x" ? 0 : l.data).toString(),
  timeStamp: String(Number(l.blockTimestamp ?? 0)),
  blockNumber: String(Number(l.blockNumber)),
  hash: l.transactionHash,
  logIndex: Number(l.logIndex),
});

export function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}
