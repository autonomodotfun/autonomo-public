import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { untilLocalDbIsFree } from "@/lib/prerender";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getDb, schema } from "@/db";
import { TOKEN } from "@/lib/constants";
import { USDC_BASE, USDG } from "@/lib/payments/payments";

// Burn on paid calls. Each payee gets its own BurnSplitter contract (contracts/robinhood/src/BurnSplitter.sol), and gateways are
// paid there instead of to the payee. Flushing a splitter sends 5% of $AUTONOMO to the dead address and 5% of USDG
// to the BuybackBurner, which buys $AUTONOMO with it and burns that; the payee gets the rest. Verified still checks
// the payee, since the splitter holds nothing for long.
//
// A payment flushes its payee's splitter once that holds 1,000 $AUTONOMO or 0.10 USDG, and a daily run catches anyone below
// that. The keeper is its own wallet: flushing from the facilitator could clash with a payment it's settling at the same moment.
//
// Env:
//   BURN_SPLITTER_FACTORY   The deployed BurnSplitterFactory. Without it, payments go straight to payees as before.
//   BURN_SPLITTER_FACTORY_PREVIOUS
//                           The factory used before the current one, after a switch (v1 to BurnSplitterFactoryV2). New
//                           payments go to the current factory's splitters; the daily run still flushes the previous
//                           ones, which can hold payments from before the switch, and their burns still count on /burn.
//   BUYBACK_BURNER          The deployed BuybackBurner.
//   BURN_KEEPER_PRIVATE_KEY The BuybackBurner's keeper: a gas-only wallet that flushes and runs buybacks.
//   BURN_START_BLOCK        The block the contracts were deployed in, where the search for burn receipts starts.
//   MIRROR_BURN_POT         The deployed MirrorBurnPot, for the mirror burn of payments on Base (see below).
//   BASE_SPLITTER_FACTORY   The BurnSplitterFactory deployed on Base, for creator APIs paid in USDC there (see below).
//                           Without it, only official APIs take Base.

export const BURN_BPS = 500;
export const BURN_DEAD = "0x000000000000000000000000000000000000dEaD";

const factoryAbi = parseAbi([
  "function splitterOf(address recipient) view returns (address)",
  "function flush(address recipient, address[] tokens) returns (address)",
]);
const buybackAbi = parseAbi([
  "function buyAndBurn(uint256 usdgIn, uint256 minOut) returns (uint256)",
  "function keeper() view returns (address)",
]);
const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const flushedEvent = parseAbiItem("event Flushed(address indexed token, uint256 toRecipient, uint256 toBurn)");
const boughtEvent = parseAbiItem("event BoughtAndBurned(uint256 usdgIn, uint256 ethIn, uint256 autonomoBurned)");
const burnedEvent = parseAbiItem("event Burned(uint256 autonomoBurned)");

const robinhood = defineChain({
  id: TOKEN.chainId,
  name: TOKEN.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [TOKEN.rpcUrl] } },
});
const transport = () => http(process.env.ROBINHOOD_RPC_URL?.trim() || TOKEN.rpcUrl, { timeout: 15_000 });
const publicClient = createPublicClient({ chain: robinhood, transport: transport() });

function envAddress(name: string) {
  const v = process.env[name]?.trim();
  return v && isAddress(v) ? getAddress(v) : null;
}

export const burnFactory = () => envAddress("BURN_SPLITTER_FACTORY");
/** The factory before the current one, while its splitters may still hold payments. Null when unset or the same. */
export const previousBurnFactory = () => {
  const previous = envAddress("BURN_SPLITTER_FACTORY_PREVIOUS");
  return previous && previous !== burnFactory() ? previous : null;
};
export const buybackBurner = () => envAddress("BUYBACK_BURNER");
export const burnEnabled = () => burnFactory() !== null;
/** The share of each payment that's burned, for pages to show; undefined while burning is off. */
export const burnPercent = () => (burnEnabled() ? BURN_BPS / 100 : undefined);

// A splitter's address only depends on the factory and the payee, so a lookup never goes stale.
const splitters = new Map<string, Address>();

async function splitterFrom(factory: Address, payee: string): Promise<Address> {
  const key = `${factory}:${payee.toLowerCase()}`;
  const hit = splitters.get(key);
  if (hit) return hit;
  const splitter = await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "splitterOf", args: [getAddress(payee)] });
  splitters.set(key, splitter);
  return splitter;
}

/** The address a payee's gateways are paid at: its splitter when burning is on, otherwise the payee itself. */
export async function payToFor(payee: string): Promise<string> {
  const factory = burnFactory();
  return factory ? splitterFrom(factory, payee) : payee;
}

/**
 * Every wallet that gateways pay or have paid, so the keeper knows which splitters to flush. A wallet that was switched
 * away from keeps its splitter, which can still hold payments from before the switch.
 */
async function payees() {
  const db = await getDb();
  const result = await db.execute<{ payee: string }>(sql`
    select lower(coalesce(pay_to, owner)) as payee from gateways
    union select lower(from_owner) from wallet_switches
    union select lower(to_owner) from wallet_switches`);
  const rows = "rows" in result ? result.rows : (result as unknown as { payee: string }[]);
  return rows.map((r) => r.payee).filter((p) => isAddress(p)).map((p) => getAddress(p));
}

// A payment flushes a splitter at these.
const FLUSH_AT_AUTONOMO = 1_000n * 10n ** 18n;
const FLUSH_AT_USDG = 100_000n; // 0.10 USDG
// Below these, gas would take too much of what a flush or a buyback moves, so even the daily run leaves them.
const MIN_FLUSH_AUTONOMO = 100n * 10n ** 18n;
const MIN_FLUSH_USDG = 100_000n; // 0.10 USDG
const MIN_BUYBACK_USDG = 100_000n; // 0.1 USDG
// The token's pool is thin: 100 USDG moves the price by about 1%, 1,000 by about 8%. Anything above this waits for later runs.
const MAX_BUYBACK_USDG = 100_000_000n; // 100 USDG
// The keeper quotes a buyback by simulating it, then accepts up to this much less when it lands.
const BUYBACK_SLIPPAGE_BPS = 200n;

export type BurnRun = {
  flushed: { payee: string; splitter: string; tx: string }[];
  baseFlushed: { payee: string; splitter: string; tx: string }[];
  mirror: { usdgSent: string; paidOnBase: string; stillOwed: string; tx: string } | null;
  buyback: { usdgIn: string; quotedBurn: string; tx: string } | null;
  receipts: number;
  errors: string[];
};

function keeper() {
  const factory = burnFactory();
  const key = process.env.BURN_KEEPER_PRIVATE_KEY?.trim();
  if (!factory || !key) throw new Error("BURN_SPLITTER_FACTORY and BURN_KEEPER_PRIVATE_KEY must be set");
  const account = privateKeyToAccount(key as Hex);
  return { factory, account, wallet: createWalletClient({ account, chain: robinhood, transport: transport() }) };
}

type Keeper = ReturnType<typeof keeper>;

/**
 * Flushes a payee's splitter if it holds enough to be worth it, or with `atThreshold`, only once it reaches a threshold.
 * The splitter is the current factory's unless `factory` names the previous one.
 */
async function flushPayee(k: Keeper, payee: Address, atThreshold = false, factory: Address = k.factory) {
  const splitter = await splitterFrom(factory, payee);
  const [autonomo, usdg] = await Promise.all(
    [TOKEN.address, USDG.address].map((token) =>
      publicClient.readContract({ address: token as Address, abi: balanceAbi, functionName: "balanceOf", args: [splitter as Address] }),
    ),
  );
  if (atThreshold && autonomo < FLUSH_AT_AUTONOMO && usdg < FLUSH_AT_USDG) return null;
  const tokens: Address[] = [];
  if (autonomo >= MIN_FLUSH_AUTONOMO) tokens.push(TOKEN.address as Address);
  if (usdg >= MIN_FLUSH_USDG) tokens.push(USDG.address);
  if (!tokens.length) return null;
  const hash = await k.wallet.writeContract({ address: factory, abi: factoryAbi, functionName: "flush", args: [payee, tokens] });
  await publicClient.waitForTransactionReceipt({ hash });
  return { payee, splitter, tx: hash };
}

/** Buys back and burns with the USDG collected, once there's enough to be worth it. */
async function runBuyback(k: Keeper) {
  const buyback = buybackBurner();
  if (!buyback) return null;
  const held = await publicClient.readContract({ address: USDG.address, abi: balanceAbi, functionName: "balanceOf", args: [buyback] });
  if (held < MIN_BUYBACK_USDG) return null;
  const usdgIn = held < MAX_BUYBACK_USDG ? held : MAX_BUYBACK_USDG;
  const { result: quoted } = await publicClient.simulateContract({
    account: k.account,
    address: buyback,
    abi: buybackAbi,
    functionName: "buyAndBurn",
    args: [usdgIn, 1n],
  });
  const minOut = (quoted * (10_000n - BUYBACK_SLIPPAGE_BPS)) / 10_000n;
  const hash = await k.wallet.writeContract({ address: buyback, abi: buybackAbi, functionName: "buyAndBurn", args: [usdgIn, minOut] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`buyback reverted in ${hash}`);
  return { usdgIn: usdgIn.toString(), quotedBurn: quoted.toString(), tx: hash };
}

/** The daily backup: flushes every splitter holding enough, then buys back. Catches creators with few calls. */
export async function runBurnKeeper(): Promise<BurnRun> {
  const k = keeper();
  const run: BurnRun = { flushed: [], baseFlushed: [], mirror: null, buyback: null, receipts: 0, errors: [] };

  const previous = previousBurnFactory();
  for (const payee of await payees()) {
    try {
      const flushed = await flushPayee(k, payee);
      if (flushed) run.flushed.push(flushed);
    } catch (e) {
      run.errors.push(`flush ${payee}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // The splitter from before the switch, for payments that reached it before (or a quote issued just before).
    if (previous) {
      try {
        const flushed = await flushPayee(k, payee, false, previous);
        if (flushed) run.flushed.push(flushed);
      } catch (e) {
        run.errors.push(`flush ${payee} (previous factory): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (baseSplitterFactory()) {
    for (const payee of await payees()) {
      try {
        const flushed = await flushBasePayee(payee);
        if (flushed) run.baseFlushed.push(flushed);
      } catch (e) {
        run.errors.push(`base flush ${payee}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Before the buyback, so the mirrored USDG is bought and burned in the same run.
  try {
    run.mirror = await runMirror(k);
  } catch (e) {
    run.errors.push(`mirror: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    run.buyback = await runBuyback(k);
  } catch (e) {
    run.errors.push(`buyback: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    run.receipts = await syncBurnReceipts();
    revalidateTag(BURNS_TAG, { expire: 0 });
  } catch (e) {
    run.errors.push(`receipts: ${e instanceof Error ? e.message : String(e)}`);
  }
  return run;
}

/**
 * Called after each settled payment: flushes the payee's splitter once it reaches a threshold, then tries a buyback.
 * Simultaneous calls can both see the threshold, which only wastes a little gas: a flush can't send money anywhere else.
 * A failed flush isn't retried here, since the next payment or the daily run picks the money up.
 */
export async function noteBurnCall(payee: string) {
  if (!burnEnabled() || !process.env.BURN_KEEPER_PRIVATE_KEY?.trim()) return;
  const k = keeper();
  const flushed = await flushPayee(k, getAddress(payee), true);
  if (!flushed) return;
  await runBuyback(k);
  await syncBurnReceipts();
  revalidateTag(BURNS_TAG, { expire: 0 });
}

// ---------- splitters on Base ----------
// Creator APIs paid in USDC on Base are paid to the creator's splitter there, from the BaseSplitterFactory
// (contracts/base/src/BaseSplitter.sol: BurnSplitter's logic, named for Base). A flush sends 95% to the creator and 5% to
// its reserve, Autonomo's Base Safe, which refills the mirror burn pot below, so the burn on creators' Base payments
// pays for itself. Official APIs on Base are paid to the Safe itself. The factory's splitterOf and flush match
// BurnSplitterFactory's, so factoryAbi serves both.
// The keeper flushes with the same key on Base, so it needs a little ETH there.

export const baseSplitterFactory = () => envAddress("BASE_SPLITTER_FACTORY");
const baseTransport = () => http(process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org", { timeout: 15_000 });
const baseClient = createPublicClient({ chain: base, transport: baseTransport() });
const baseSplitters = new Map<string, Address>();
// A Base payment flushes its creator's splitter once it holds this much, and the daily run anything from it.
const FLUSH_AT_USDC = 100_000n; // 0.10 USDC

/** The creator's splitter on Base, where their API's USDC on Base is paid. Null while Base splitters are off. */
export async function baseSplitterFor(payee: string): Promise<Address | null> {
  const factory = baseSplitterFactory();
  if (!factory) return null;
  const key = `${factory}:${payee.toLowerCase()}`;
  const hit = baseSplitters.get(key);
  if (hit) return hit;
  const splitter = await baseClient.readContract({ address: factory, abi: factoryAbi, functionName: "splitterOf", args: [getAddress(payee)] });
  baseSplitters.set(key, splitter);
  return splitter;
}

async function flushBasePayee(payee: Address) {
  const factory = baseSplitterFactory();
  const key = process.env.BURN_KEEPER_PRIVATE_KEY?.trim();
  if (!factory || !key) return null;
  const splitter = await baseSplitterFor(payee);
  if (!splitter) return null;
  const held = await baseClient.readContract({ address: USDC_BASE.address as Address, abi: balanceAbi, functionName: "balanceOf", args: [splitter] });
  if (held < FLUSH_AT_USDC) return null;
  const wallet = createWalletClient({ account: privateKeyToAccount(key as Hex), chain: base, transport: baseTransport() });
  const hash = await wallet.writeContract({ address: factory, abi: factoryAbi, functionName: "flush", args: [payee, [USDC_BASE.address as Address]] });
  const receipt = await baseClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`base flush reverted in ${hash}`);
  return { payee, splitter, tx: hash };
}

/** Called after each settled Base payment to a creator's splitter: flushes it once it holds 0.10 USDC. */
export async function noteBaseBurnCall(payee: string) {
  if (!baseSplitterFactory() || !process.env.BURN_KEEPER_PRIVATE_KEY?.trim()) return;
  await flushBasePayee(getAddress(payee));
}

// ---------- mirror burn for Base ----------
// USDC paid on Base can't be burned there: there's no $AUTONOMO pool on Base. So the MirrorBurnPot (contracts/robinhood/src/MirrorBurnPot.sol) holds a float of USDG on Robinhood Chain, and the
// daily run sends 5% of all Base payments so far from it to the BuybackBurner, which buys and burns with it like any
// other USDG. The pot keeps the running totals on-chain and refuses to send more than 5% of the total it's given, so
// what the pot couldn't cover stays owed and goes out after the next refill.

export const mirrorPot = () => envAddress("MIRROR_BURN_POT");
const potAbi = parseAbi([
  "function mirror(uint256 amount, uint256 paidElsewhere)",
  "function mirrored() view returns (uint256)",
  "function paidElsewhere() view returns (uint256)",
  "function owedFor(uint256 paidElsewhere) view returns (uint256)",
]);
// Robinhood Chain gas is a fraction of a cent, so even small amounts are worth sending. The buyback waits for 0.10 USDG.
const MIN_MIRROR_USDG = 10_000n; // 0.01 USDG

/** Every settled USDC payment on Base, in USDC's 6 decimals (which USDG shares). Only official APIs take Base. */
async function paidOnBase() {
  const db = await getDb();
  const { gatewayCalls: c } = schema;
  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${c.amount}::numeric), 0)::text` })
    .from(c)
    .where(and(eq(c.settled, true), eq(c.rail, "usdc_base")));
  return BigInt(total.split(".")[0]);
}

/** Sends what's owed for Base payments from the pot to the BuybackBurner, as far as the pot holds it. */
async function runMirror(k: Keeper) {
  const pot = mirrorPot();
  if (!pot) return null;
  const [counted, onChain, held] = await Promise.all([
    paidOnBase(),
    publicClient.readContract({ address: pot, abi: potAbi, functionName: "paidElsewhere" }),
    publicClient.readContract({ address: USDG.address, abi: balanceAbi, functionName: "balanceOf", args: [pot] }),
  ]);
  // The pot refuses a total lower than the last one, which only happens if call rows were deleted.
  const total = counted > onChain ? counted : onChain;
  const owed = await publicClient.readContract({ address: pot, abi: potAbi, functionName: "owedFor", args: [total] });
  const send = owed < held ? owed : held;
  if (send < MIN_MIRROR_USDG) return null;
  const hash = await k.wallet.writeContract({ address: pot, abi: potAbi, functionName: "mirror", args: [send, total] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`mirror reverted in ${hash}`);
  return { usdgSent: send.toString(), paidOnBase: total.toString(), stillOwed: (owed - send).toString(), tx: hash };
}

export type MirrorState = { pot: string; held: string; mirrored: string; paidOnBase: string; owed: string };

const readMirror = unstable_cache(
  async (): Promise<MirrorState | null> => {
    const pot = mirrorPot();
    if (!pot) return null;
    const [counted, mirrored, held] = await Promise.all([
      paidOnBase(),
      publicClient.readContract({ address: pot, abi: potAbi, functionName: "mirrored" }),
      publicClient.readContract({ address: USDG.address, abi: balanceAbi, functionName: "balanceOf", args: [pot] }),
    ]);
    const due = (counted * BigInt(BURN_BPS)) / 10_000n;
    return {
      pot,
      held: held.toString(),
      mirrored: mirrored.toString(),
      paidOnBase: counted.toString(),
      owed: (due > mirrored ? due - mirrored : 0n).toString(),
    };
  },
  ["burn-mirror"],
  { revalidate: 300, tags: ["burns"] },
);

/** The mirror burn's pot, what it has sent and what's still owed, for the /burn page. Null until the pot is set. */
export async function getMirror() {
  await untilLocalDbIsFree();
  return readMirror().catch((e) => {
    console.error("mirror read failed", e);
    return null;
  });
}

// ---------- receipts ----------

const BURNS_TAG = "burns";
// The public RPC allows 10M blocks for one address and one event, but only 100,000 for a search with several of either.
// So each contract and event gets its own search. A paid RPC can allow less (Alchemy: 10,000 blocks, or any range
// returning 10,000 logs or fewer), so a search it refuses as too big is split in half until it fits.
const LOG_RANGE = 5_000_000n;

async function logsIn<T>(from: bigint, to: bigint, get: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  try {
    return await get(from, to);
  } catch (e) {
    const said = `${(e as { details?: string }).details ?? (e as Error).message}`;
    // Being rate limited isn't a range problem: splitting would only send more requests.
    if ((e as { status?: number }).status === 429 || /too many requests|rate.?limit/i.test(said)) throw e;
    if (to - from < 500n || !/exceed|limit|too many|spans|allowed|range/i.test(said)) throw e;
    const mid = from + (to - from) / 2n;
    return [...(await logsIn(from, mid, get)), ...(await logsIn(mid + 1n, to, get))];
  }
}

/**
 * Copies burns from the chain into burn_receipts and returns how many it saw. Only logs from this deployment's
 * splitters and buyback count, so another contract emitting the same events can't add a burn. It reads the chain instead
 * of the keeper's own transactions because anyone can flush a splitter.
 */
async function syncBurnReceipts() {
  const buyback = buybackBurner();
  const db = await getDb();
  const { burnReceipts } = schema;

  const [{ last }] = await db.select({ last: sql<string | null>`max(${burnReceipts.blockNumber})` }).from(burnReceipts);
  const startBlock = process.env.BURN_START_BLOCK?.trim();
  if (last === null && !startBlock) throw new Error("BURN_START_BLOCK is not set");
  let from = BigInt(last ?? startBlock!);

  const factories = [burnFactory(), previousBurnFactory()].filter((f): f is Address => f !== null);
  const everyPayee = await payees();
  const splitterAddresses = await Promise.all(factories.flatMap((f) => everyPayee.map((p) => splitterFrom(f, p))));

  // Not cached: viem otherwise reuses the block number for a few seconds and would miss a flush that just landed.
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  const rows: { tx: Hex; logIndex: number; kind: string; burned: bigint; usdgIn: string | null; block: bigint }[] = [];
  for (; from <= latest; from += LOG_RANGE) {
    const to = from + LOG_RANGE - 1n < latest ? from + LOG_RANGE - 1n : latest;
    const at = (log: { transactionHash: Hex; logIndex: number; blockNumber: bigint }) => ({ tx: log.transactionHash, logIndex: log.logIndex, block: log.blockNumber });
    for (const address of splitterAddresses) {
      for (const log of await logsIn(from, to, (a, b) => publicClient.getLogs({ address, event: flushedEvent, fromBlock: a, toBlock: b }))) {
        if (log.args.token?.toLowerCase() === TOKEN.address && log.args.toBurn) {
          rows.push({ ...at(log), kind: "payment", burned: log.args.toBurn, usdgIn: null });
        }
      }
    }
    if (buyback) {
      for (const log of await logsIn(from, to, (a, b) => publicClient.getLogs({ address: buyback, event: boughtEvent, fromBlock: a, toBlock: b }))) {
        rows.push({ ...at(log), kind: "buyback", burned: log.args.autonomoBurned!, usdgIn: log.args.usdgIn!.toString() });
      }
      for (const log of await logsIn(from, to, (a, b) => publicClient.getLogs({ address: buyback, event: burnedEvent, fromBlock: a, toBlock: b }))) {
        rows.push({ ...at(log), kind: "other", burned: log.args.autonomoBurned!, usdgIn: null });
      }
    }
  }

  // The next search starts at the newest saved block, so everything is read before anything is saved, oldest first.
  // Otherwise a failure partway could leave an older burn behind that later searches never go back for.
  rows.sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1));
  const times = new Map<bigint, Date>();
  for (const r of rows) {
    let burnedAt = times.get(r.block);
    if (!burnedAt) {
      burnedAt = new Date(Number((await publicClient.getBlock({ blockNumber: r.block })).timestamp) * 1000);
      times.set(r.block, burnedAt);
    }
    await db
      .insert(burnReceipts)
      .values({ tx: r.tx, logIndex: r.logIndex, kind: r.kind, burned: r.burned.toString(), usdgIn: r.usdgIn, blockNumber: Number(r.block), burnedAt })
      .onConflictDoNothing();
  }
  return rows.length;
}

export type BurnReceipt = { tx: string; logIndex: number; kind: string; burned: string; usdgIn: string | null; burnedAt: string };
export type BurnTotal = { kind: string; count: number; burned: string; usdgIn: string };

const RECEIPTS_SHOWN = 200;

const readBurns = unstable_cache(
  async () => {
    const db = await getDb();
    const { burnReceipts: t } = schema;
    const [totals, rows] = await Promise.all([
      db
        .select({
          kind: t.kind,
          count: sql<number>`count(*)::int`,
          burned: sql<string>`sum(${t.burned}::numeric)::text`,
          usdgIn: sql<string>`coalesce(sum(${t.usdgIn}::numeric), 0)::text`,
        })
        .from(t)
        .groupBy(t.kind),
      db.select().from(t).orderBy(desc(t.blockNumber), desc(t.logIndex)).limit(RECEIPTS_SHOWN),
    ]);
    return {
      totals: totals as BurnTotal[],
      receipts: rows.map((r): BurnReceipt => ({ tx: r.tx, logIndex: r.logIndex, kind: r.kind, burned: r.burned, usdgIn: r.usdgIn, burnedAt: r.burnedAt.toISOString() })),
    };
  },
  ["burn-receipts"],
  { revalidate: 300, tags: [BURNS_TAG] },
);

/** Totals per kind of burn and the latest receipts, for the /burn page. */
export async function getBurns() {
  await untilLocalDbIsFree();
  return readBurns();
}
