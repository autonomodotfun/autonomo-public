import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient, defineChain, http, parseAbi, toHex, type Hex } from "viem";
import { base } from "viem/chains";
import { TOKEN } from "@/lib/constants";

// The price of $AUTONOMO, read from its own Uniswap pool: a time-weighted average over a window, so one trade in a thin
// pool can't move it, times ETH/USD from Chainlink. Verified uses a weekly average (src/lib/trust/verified.ts); API prices
// in $AUTONOMO use the average of the previous UTC day (dayPriceUsd below).

const BLOCK_S = 0.125;
const DAY_S = 24 * 3600;

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"; // data: amount0, amount1, sqrtPriceX96, …
// $AUTONOMO's Uniswap v4 ETH pool. currency0 is ETH, so the pool price is tokens per ETH.
const POOL_ID = "0x0785dca2d20352f173f88dd63a0d052ce017a7ba729f5d2a78fdb77a535f7195";
const POOL_BLOCK = 100_925_628n; // when it was created, so no search goes further back
const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);

export const client = createPublicClient({
  chain: defineChain({
    id: TOKEN.chainId,
    name: TOKEN.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [TOKEN.rpcUrl] } },
  }),
  transport: http(process.env.ROBINHOOD_RPC_URL || undefined, { timeout: 15_000 }),
});
const baseClient = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined, { timeout: 8_000 }) });

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
    // Being rate limited isn't a range problem: splitting would only send more requests.
    if ((e as { status?: number }).status === 429 || /too many requests|rate.?limit/i.test(message)) throw e;
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

export async function ethUsd() {
  const [round, decimals] = await Promise.all([
    baseClient.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "latestRoundData" }),
    baseClient.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "decimals" }),
  ]);
  return Number(round[1]) / 10 ** decimals;
}


/** The average over one UTC day (days count from the unix epoch), in USD per token. Throws if it can't be read. */
async function averageForDay(day: number) {
  const end = day * DAY_S;
  const [priceEth, eth] = await Promise.all([averagePriceEth(end - DAY_S, end), ethUsd()]);
  return priceEth * eth;
}

const cachedDay = unstable_cache(averageForDay, ["autonomo-day-price"], { revalidate: 3 * DAY_S });

/**
 * The $AUTONOMO price API prices follow today: the average of the previous full UTC day, in USD per token. It stays the
 * same all day, so the form, a save and the daily repricing all use the same number. Falls back to the day before;
 * throws only if neither can be read.
 */
export async function dayPriceUsd(now = Date.now()) {
  const today = Math.floor(now / 1000 / DAY_S);
  return cachedDay(today).catch((e) => {
    console.error("$AUTONOMO day price failed, using the day before", e);
    return cachedDay(today - 1);
  });
}

/** dayPriceUsd, or null when the chain can't be read, for pages that can show the price without it. */
export const dayPriceOrNull = () => dayPriceUsd().catch(() => null);
