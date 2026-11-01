import "server-only";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { createPublicClient, defineChain, erc20Abi, formatUnits, http, parseAbi, toHex, type Hex } from "viem";
import { base } from "viem/chains";
import { getDb, schema } from "@/db";
import { TOKEN } from "@/lib/constants";

// Launching an API is free. A wallet holding about a set dollar value of $AUTONOMO shows as Verified on its APIs;
// the tokens stay in the wallet, and the badge goes away if the balance drops below the requirement. Balances are read
// live from the chain. Verified says the provider holds the token, not that the API was reviewed.
//
// The requirement in tokens is set once a week from the previous full week's average pool price, so badges don't
// flicker with the market and one trade in a thin pool can't move it.
//
// The amount is rounded to a round number of tokens, so it can come to slightly more or less than the dollar value.
//
// A wallet that qualifies keeps that amount: it never has to hold more, and it moves down if the weekly amount falls
// below it. A wallet found below its amount loses the lock and qualifies again at the current weekly amount.
//
// Env: VERIFIED_USD   Dollar value to aim for (default 27). 0 turns Verified off.

const DEFAULT_USD = 27;
// Whatever the price does, the requirement stays between these (whole tokens).
const MIN_TOKENS = 100_000;
const MAX_TOKENS = 5_000_000;
const ROUND_TOKENS = 100_000;

const WEEK_S = 7 * 24 * 3600;
const BLOCK_S = 0.125;

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"; // data: amount0, amount1, sqrtPriceX96, …
// $AUTONOMO's Uniswap v4 ETH pool. currency0 is ETH, so the pool price is tokens per ETH.
const POOL_ID = "0x0785dca2d20352f173f88dd63a0d052ce017a7ba729f5d2a78fdb77a535f7195";
const POOL_BLOCK = 100_925_628n; // when it was created, so no search goes further back
const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);

const client = createPublicClient({
  chain: defineChain({
    id: TOKEN.chainId,
    name: TOKEN.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [TOKEN.rpcUrl] } },
  }),
  transport: http(process.env.ROBINHOOD_RPC_URL || undefined, { timeout: 15_000 }),
});
const baseClient = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined, { timeout: 8_000 }) });

/** Dollar value required for Verified. */
export function verifiedUsd() {
  const raw = process.env.VERIFIED_USD?.trim();
  return raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : DEFAULT_USD;
}

export function verifiedEnabled() {
  return verifiedUsd() > 0;
}

export const verifiedAmount = () => `$${verifiedUsd().toLocaleString("en-US")}`;

type SwapLog = { blockNumber: Hex; data: Hex };

async function swapsBetween(from: bigint, to: bigint): Promise<SwapLog[]> {
  try {
    const logs = await client.request({
      method: "eth_getLogs",
      params: [{ address: POOL_MANAGER, topics: [V4_SWAP, POOL_ID], fromBlock: toHex(from), toBlock: toHex(to) }],
    });
    return logs as unknown as SwapLog[];
  } catch (e) {
    const message = `${(e as { details?: string }).details ?? (e as Error).message}`;
    if (to - from < 500n || !/exceed|limit|too many|spans|allowed/i.test(message)) throw e;
    const mid = from + (to - from) / 2n;
    return [...(await swapsBetween(from, mid)), ...(await swapsBetween(mid + 1n, to))];
  }
}

/** The block closest to a unix time, estimated from block spacing and corrected against the chain. */
async function blockAt(time: number) {
  const latest = await client.getBlock();
  let guess = latest.number;
  let at = Number(latest.timestamp);
  for (let i = 0; i < 4 && Math.abs(at - time) > 60; i++) {
    guess = BigInt(Math.max(1, Number(guess) + Math.round((time - at) / BLOCK_S)));
    if (guess > latest.number) guess = latest.number;
    at = Number((await client.getBlock({ blockNumber: guess })).timestamp);
  }
  return guess;
}

const tokensPerEth = (log: SwapLog) => {
  const sqrt = Number(BigInt(`0x${log.data.slice(2 + 128, 2 + 192)}`)) / 2 ** 96;
  return sqrt * sqrt;
};

/** Time-weighted geometric average of the pool's ETH price per token over [start, end) (unix seconds). */
export async function averagePriceEth(start: number, end: number) {
  const [first, to] = await Promise.all([blockAt(start), blockAt(end)]);
  if (to <= POOL_BLOCK) throw new Error("the pool didn't exist yet");
  const from = first > POOL_BLOCK ? first : POOL_BLOCK;
  const swaps = await swapsBetween(from, to);

  // The price going into the window is the last swap before it.
  const opening = from > POOL_BLOCK ? (await swapsBetween(POOL_BLOCK, from - 1n)).at(-1) : undefined;

  const points = opening ? [{ ...opening, blockNumber: toHex(from) }, ...swaps] : swaps;
  if (!points.length) throw new Error("no swaps to price $AUTONOMO from");
  let weighted = 0;
  let total = 0;
  points.forEach((p, i) => {
    const stop = i + 1 < points.length ? BigInt(points[i + 1].blockNumber) : to;
    const weight = Number(stop - BigInt(p.blockNumber));
    weighted += Math.log(1 / tokensPerEth(p)) * weight;
    total += weight;
  });
  return total > 0 ? Math.exp(weighted / total) : 1 / tokensPerEth(points.at(-1)!);
}

async function ethUsd() {
  const [round, decimals] = await Promise.all([
    baseClient.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "latestRoundData" }),
    baseClient.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "decimals" }),
  ]);
  return Number(round[1]) / 10 ** decimals;
}

/** Whole tokens worth `usd` at a price, rounded to the nearest step and kept within the limits. */
export function tokensFor(usd: number, priceUsd: number) {
  const tokens = Math.round(usd / priceUsd / ROUND_TOKENS) * ROUND_TOKENS;
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, tokens));
}

/** The price for a week (weeks count from the unix epoch), from the full week before it. Throws if it can't be read. */
async function weekPriceUsd(week: number) {
  const end = week * WEEK_S;
  const [priceEth, eth] = await Promise.all([
    // A pool younger than a week has nothing to average in the week before, so it uses what it has so far.
    averagePriceEth(end - WEEK_S, end).catch(() => averagePriceEth(end, Math.floor(Date.now() / 1000))),
    ethUsd(),
  ]);
  return priceEth * eth;
}

const cachedWeekPrice = unstable_cache(weekPriceUsd, ["verified-week-price"], { revalidate: 2 * WEEK_S });

/** This week's requirement in whole tokens. Falls back to last week's price; throws only if neither can be read. */
export async function verifiedTokens() {
  const week = Math.floor(Date.now() / 1000 / WEEK_S);
  const priceUsd = await cachedWeekPrice(week).catch((e) => {
    console.error("verified price failed, using last week's", e);
    return cachedWeekPrice(week - 1);
  });
  return tokensFor(verifiedUsd(), priceUsd);
}

function readBalance(owner: string) {
  return client.readContract({ address: TOKEN.address as Hex, abi: erc20Abi, functionName: "balanceOf", args: [owner as Hex] });
}

const meets = (balance: bigint, tokens: number) => balance >= BigInt(tokens) * 10n ** BigInt(TOKEN.decimals);

/**
 * Applies the lock rules for a wallet and saves any change. Needs a real balance and weekly amount. If the database
 * can't be reached the wallet is judged on the weekly amount, and the lock is saved on a later check.
 */
async function standing(owner: string, balance: bigint, weekly: number) {
  const key = owner.toLowerCase();
  const { verifiedWallets } = schema;
  try {
    const db = await getDb();
    const [lock] = await db.select().from(verifiedWallets).where(eq(verifiedWallets.owner, key)).limit(1);
    const tokens = lock ? Math.min(lock.tokens, weekly) : weekly;
    const verified = meets(balance, tokens);
    if (lock && !verified) {
      await db.delete(verifiedWallets).where(eq(verifiedWallets.owner, key));
    } else if (lock && tokens < lock.tokens) {
      await db.update(verifiedWallets).set({ tokens, updatedAt: new Date() }).where(eq(verifiedWallets.owner, key));
    } else if (!lock && verified) {
      await db.insert(verifiedWallets).values({ owner: key, tokens }).onConflictDoNothing();
    }
    return { tokens: verified ? tokens : weekly, verified, locked: verified };
  } catch (e) {
    console.error("verified lock failed", e);
    return { tokens: weekly, verified: meets(balance, weekly), locked: false };
  }
}

/** Whether a wallet holds its requirement. Throws if it can't be read, so callers never cache a wrong "no". */
export async function holdsMinimum(owner: string) {
  if (!verifiedEnabled()) return false;
  const [balance, weekly] = await Promise.all([readBalance(owner), verifiedTokens()]);
  return (await standing(owner, balance, weekly)).verified;
}

const whole = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** A wallet's standing for its dashboard. `balance` or `required` is null when it couldn't be read. */
export async function verifiedStatus(owner: string) {
  const [balance, tokens] = await Promise.allSettled([readBalance(owner), verifiedTokens()]);
  for (const r of [balance, tokens]) if (r.status === "rejected") console.error("verified check failed", r.reason);
  const held = balance.status === "fulfilled" ? balance.value : null;
  const weekly = tokens.status === "fulfilled" ? tokens.value : null;
  const state =
    verifiedEnabled() && held !== null && weekly !== null
      ? await standing(owner, held, weekly)
      : { tokens: weekly, verified: false, locked: false };
  return {
    balance: held === null ? null : whole(Number(formatUnits(held, TOKEN.decimals))),
    required: state.tokens === null ? null : whole(state.tokens),
    verified: state.verified,
    locked: state.locked,
  };
}
