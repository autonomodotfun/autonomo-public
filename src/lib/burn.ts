import "server-only";
import { desc, sql } from "drizzle-orm";
import { connection } from "next/server";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDb, schema } from "@/db";
import { TOKEN } from "@/lib/constants";
import { USDG } from "@/lib/payments";

// Burn on paid calls. Each payee gets its own BurnSplitter contract (contracts/src/BurnSplitter.sol), and gateways are
// paid there instead of to the payee. Flushing a splitter sends 5% of $AUTONOMO to the dead address and 5% of USDG
// to the BuybackBurner, which buys $AUTONOMO with it and burns that; the payee gets the rest. Verified still checks
// the payee, since the splitter holds nothing for long.
//
// Env:
//   BURN_SPLITTER_FACTORY   The deployed BurnSplitterFactory. Without it, payments go straight to payees as before.
//   BUYBACK_BURNER          The deployed BuybackBurner, which the keeper (FACILITATOR_PRIVATE_KEY) triggers.
//   BURN_START_BLOCK        The block the contracts were deployed in, where the search for burn receipts starts.

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
const burnEvents = parseAbi([
  "event Flushed(address indexed token, uint256 toRecipient, uint256 toBurn)",
  "event BoughtAndBurned(uint256 usdgIn, uint256 ethIn, uint256 autonomoBurned)",
  "event Burned(uint256 autonomoBurned)",
]);

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
export const buybackBurner = () => envAddress("BUYBACK_BURNER");
export const burnEnabled = () => burnFactory() !== null;
/** The share of each payment that's burned, for pages to show; undefined while burning is off. */
export const burnPercent = () => (burnEnabled() ? BURN_BPS / 100 : undefined);

// A splitter's address only depends on the factory and the payee, so a lookup never goes stale.
const splitters = new Map<string, Address>();

/** The address a payee's gateways are paid at: its splitter when burning is on, otherwise the payee itself. */
export async function payToFor(payee: string): Promise<string> {
  const factory = burnFactory();
  if (!factory) return payee;
  const key = `${factory}:${payee.toLowerCase()}`;
  const hit = splitters.get(key);
  if (hit) return hit;
  const splitter = await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "splitterOf", args: [getAddress(payee)] });
  splitters.set(key, splitter);
  return splitter;
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

// Below these a flush or a buyback costs more in gas than it moves.
const MIN_FLUSH_AUTONOMO = 100n * 10n ** 18n;
const MIN_FLUSH_USDG = 100_000n; // 0.10 USDG
const MIN_BUYBACK_USDG = 1_000_000n; // 1 USDG
// The keeper quotes a buyback by simulating it, then accepts up to this much less when it lands.
const BUYBACK_SLIPPAGE_BPS = 200n;

export type BurnRun = {
  flushed: { payee: string; splitter: string; tx: string }[];
  buyback: { usdgIn: string; quotedBurn: string; tx: string } | null;
  receipts: number;
  errors: string[];
};

/** Flushes every splitter holding enough to be worth it, then buys back and burns with the USDG collected. */
export async function runBurnKeeper(): Promise<BurnRun> {
  const factory = burnFactory();
  const key = process.env.FACILITATOR_PRIVATE_KEY?.trim();
  if (!factory || !key) throw new Error("BURN_SPLITTER_FACTORY and FACILITATOR_PRIVATE_KEY must be set");
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain: robinhood, transport: transport() });
  const run: BurnRun = { flushed: [], buyback: null, receipts: 0, errors: [] };

  for (const payee of await payees()) {
    try {
      const splitter = await payToFor(payee);
      const [autonomo, usdg] = await Promise.all(
        [TOKEN.address, USDG.address].map((token) =>
          publicClient.readContract({ address: token as Address, abi: balanceAbi, functionName: "balanceOf", args: [splitter as Address] }),
        ),
      );
      const tokens: Address[] = [];
      if (autonomo >= MIN_FLUSH_AUTONOMO) tokens.push(TOKEN.address as Address);
      if (usdg >= MIN_FLUSH_USDG) tokens.push(USDG.address);
      if (!tokens.length) continue;
      const hash = await wallet.writeContract({ address: factory, abi: factoryAbi, functionName: "flush", args: [payee, tokens] });
      await publicClient.waitForTransactionReceipt({ hash });
      run.flushed.push({ payee, splitter, tx: hash });
    } catch (e) {
      run.errors.push(`flush ${payee}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const buyback = buybackBurner();
  if (buyback) {
    try {
      const held = await publicClient.readContract({ address: USDG.address, abi: balanceAbi, functionName: "balanceOf", args: [buyback] });
      if (held >= MIN_BUYBACK_USDG) {
        const { result: quoted } = await publicClient.simulateContract({
          account,
          address: buyback,
          abi: buybackAbi,
          functionName: "buyAndBurn",
          args: [held, 1n],
        });
        const minOut = (quoted * (10_000n - BUYBACK_SLIPPAGE_BPS)) / 10_000n;
        const hash = await wallet.writeContract({ address: buyback, abi: buybackAbi, functionName: "buyAndBurn", args: [held, minOut] });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`buyback reverted in ${hash}`);
        run.buyback = { usdgIn: held.toString(), quotedBurn: quoted.toString(), tx: hash };
      }
    } catch (e) {
      run.errors.push(`buyback: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    run.receipts = await syncBurnReceipts();
    revalidateTag(BURNS_TAG, { expire: 0 });
  } catch (e) {
    run.errors.push(`receipts: ${e instanceof Error ? e.message : String(e)}`);
  }
  return run;
}

// ---------- receipts ----------

const BURNS_TAG = "burns";
const LOG_RANGE = 5_000_000n; // the public RPC refuses more than 10M blocks at once
const LOG_ADDRESSES = 200;

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

  const addresses = (await Promise.all((await payees()).map((p) => payToFor(p)))) as Address[];
  if (buyback) addresses.push(buyback);
  const buybackKey = buyback?.toLowerCase();

  // Not cached: viem otherwise reuses the block number for a few seconds and would miss a flush that just landed.
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  const rows: { tx: Hex; logIndex: number; kind: string; burned: bigint; usdgIn: string | null; block: bigint }[] = [];
  for (; from <= latest; from += LOG_RANGE) {
    const to = from + LOG_RANGE - 1n < latest ? from + LOG_RANGE - 1n : latest;
    for (let i = 0; i < addresses.length; i += LOG_ADDRESSES) {
      const logs = await publicClient.getLogs({ address: addresses.slice(i, i + LOG_ADDRESSES), events: burnEvents, fromBlock: from, toBlock: to });
      for (const log of logs) {
        const fromBuyback = log.address.toLowerCase() === buybackKey;
        const at = { tx: log.transactionHash, logIndex: log.logIndex, block: log.blockNumber };
        if (log.eventName === "Flushed" && !fromBuyback && log.args.token?.toLowerCase() === TOKEN.address && log.args.toBurn) {
          rows.push({ ...at, kind: "payment", burned: log.args.toBurn, usdgIn: null });
        } else if (log.eventName === "BoughtAndBurned" && fromBuyback) {
          rows.push({ ...at, kind: "buyback", burned: log.args.autonomoBurned!, usdgIn: log.args.usdgIn!.toString() });
        } else if (log.eventName === "Burned" && fromBuyback) {
          rows.push({ ...at, kind: "other", burned: log.args.autonomoBurned!, usdgIn: null });
        }
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
  await connection();
  return readBurns();
}
