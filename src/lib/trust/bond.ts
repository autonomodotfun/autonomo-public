import "server-only";
import { eq, inArray } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { getDb, schema } from "@/db";
import { SLASH_EVIDENCE, type SlashEvidence } from "@/data/bond-evidence";
import { bondAbi, bondStanding, bondTokensFor, lockStanding, type BondState } from "@/lib/trust/bond-rules";
import { client } from "@/lib/payments/pool-price";
import { weeklyPriceUsd } from "@/lib/trust/verified";

// The provider bond, read from the chain (contracts/robinhood/src/ProviderBond.sol). A creator locks $AUTONOMO from the
// wallet that gets paid. If a bonded API takes payments and doesn't deliver, part of the bond is slashed: a share
// refunds the payer and the rest is burned. The rules that don't need the chain are in bond-rules.ts.
//
// Bonded means about $100 of $AUTONOMO (PROVIDER_BOND_USD), turned into tokens once a week at the previous week's
// average price, the same price Verified uses. A wallet that qualifies is locked at that amount, like Verified: it never
// has to lock more, so a price drop doesn't take the badge away, and the amount moves down if the weekly one falls
// below it (table bonded_wallets). The contract's own minBond is only a floor under that amount.
//
// The site only reads. Creators send their own transactions, and Autonomo's slasher and owner wallets are never on
// the server.
//
// Env:
//   PROVIDER_BOND               The deployed ProviderBond. Without it there is no bond on the site.
//   PROVIDER_BOND_START_BLOCK   The block it was deployed in, where the search for slashes starts.
//   PROVIDER_BOND_REFUND_WALLET Optional. Autonomo's refund wallet: a slash names it as the payer when several agents
//                               lost money, and it passes the refund on to each of them.
//   PROVIDER_BOND_USD           Optional. Dollar value of the Bonded amount (default 100).

function envAddress(name: string) {
  const v = process.env[name]?.trim();
  return v && isAddress(v) ? getAddress(v) : null;
}

export const bondContract = () => envAddress("PROVIDER_BOND");
export const bondEnabled = () => bondContract() !== null;
export const bondRefundWallet = () => envAddress("PROVIDER_BOND_REFUND_WALLET");

const BOND_TAG = "bond";

export type BondSettings = {
  minBond: string;
  cooldownS: number;
  disputeWindowS: number;
  maxSlashBps: number;
  refundBps: number;
  slasher: string;
  owner: string;
  totalBonded: string;
};

async function readSettings(bond: Address): Promise<BondSettings> {
  const at = { address: bond, abi: bondAbi } as const;
  const [minBond, cooldown, disputeWindow, maxSlashBps, refundBps, slasher, owner, totalBonded] = await Promise.all([
    client.readContract({ ...at, functionName: "minBond" }),
    client.readContract({ ...at, functionName: "cooldown" }),
    client.readContract({ ...at, functionName: "disputeWindow" }),
    client.readContract({ ...at, functionName: "maxSlashBps" }),
    client.readContract({ ...at, functionName: "refundBps" }),
    client.readContract({ ...at, functionName: "slasher" }),
    client.readContract({ ...at, functionName: "owner" }),
    client.readContract({ ...at, functionName: "totalBonded" }),
  ]);
  return {
    minBond: minBond.toString(),
    cooldownS: Number(cooldown),
    disputeWindowS: Number(disputeWindow),
    maxSlashBps,
    refundBps,
    slasher,
    owner,
    totalBonded: totalBonded.toString(),
  };
}

const cachedSettings = unstable_cache(readSettings, ["bond-settings"], { revalidate: 300, tags: [BOND_TAG] });

/** The contract's settings, kept for 5 minutes. Null while the bond is off; throws if the chain can't be read. */
export async function getBondSettings() {
  const bond = bondContract();
  return bond ? cachedSettings(bond) : null;
}

/** Dollar value of the Bonded amount. */
export function bondUsd() {
  const raw = process.env.PROVIDER_BOND_USD?.trim();
  return raw && /^\d+(\.\d+)?$/.test(raw) && Number(raw) > 0 ? Number(raw) : 100;
}

const WEI = 10n ** 18n;

/** This week's Bonded amount in whole tokens, never below the contract's minBond. Throws if no weekly price can be read. */
async function weeklyBondTokens(settings: BondSettings) {
  return bondTokensFor(bondUsd(), await weeklyPriceUsd(), Number(BigInt(settings.minBond) / WEI));
}

/** This week's Bonded amount for pages: whole tokens and its dollar value. Null while the bond is off or unreadable. */
export async function getBondRequirement() {
  const bond = bondContract();
  if (!bond) return null;
  try {
    return { tokens: await weeklyBondTokens(await cachedSettings(bond)), usd: bondUsd() };
  } catch (e) {
    console.error("bond amount failed", e);
    return null;
  }
}

/** One wallet's bond, read now. */
export async function readBondState(bond: Address, wallet: string): Promise<BondState> {
  const at = { address: bond, abi: bondAbi } as const;
  const who = getAddress(wallet);
  const [[amount, pendingWithdraw, withdrawReadyAt], nextSlashAt, openSlashId] = await Promise.all([
    client.readContract({ ...at, functionName: "bonds", args: [who] }),
    client.readContract({ ...at, functionName: "nextSlashAt", args: [who] }),
    client.readContract({ ...at, functionName: "openSlashOf", args: [who] }),
  ]);
  return { amount, pendingWithdraw, withdrawReadyAt: Number(withdrawReadyAt), nextSlashAt: Number(nextSlashAt), openSlashId };
}

export type WalletBond = {
  wallet: string;
  /** Tokens that count, in the token's smallest unit. */
  active: string;
  amount: string;
  pendingWithdraw: string;
  withdrawReadyAt: number;
  /** Shows the Bonded badge: at or above its amount, and not slashed in the last 30 days. */
  bonded: boolean;
  /** At or above its amount, whatever its slash history. */
  meets: boolean;
  /** The amount this wallet is held to, in whole tokens: its locked amount, or this week's. */
  required: number;
  /** Whether that amount is locked for this wallet: it qualified, and the amount won't go up. */
  locked: boolean;
  /** When the badge comes back after a slash, in unix seconds; null when it isn't hidden. */
  hiddenUntil: number | null;
  openSlashId: number;
  /** Whether the wallet has any history with the bond: tokens locked, a slash open, or one that ran. */
  known: boolean;
};

function describe(wallet: string, s: BondState, required: number, locked: boolean, now: number): WalletBond {
  const { active, meets, bonded, hiddenUntil } = bondStanding(s, BigInt(required) * WEI, now);
  return {
    wallet: wallet.toLowerCase(),
    active: active.toString(),
    amount: s.amount.toString(),
    pendingWithdraw: s.pendingWithdraw.toString(),
    withdrawReadyAt: s.withdrawReadyAt,
    bonded,
    meets,
    hiddenUntil,
    required,
    locked,
    openSlashId: Number(s.openSlashId),
    known: s.amount > 0n || s.nextSlashAt > 0 || s.openSlashId > 0n,
  };
}

/**
 * Applies the lock rules (lockStanding in bond-rules.ts) to each wallet and saves any change. If the database can't be
 * reached, every wallet is judged on the weekly amount, and locks are saved on a later read.
 */
async function applyLocks(wallets: string[], states: BondState[], weekly: number) {
  const out = new Map<string, { tokens: number; locked: boolean }>();
  const { bondedWallets } = schema;
  try {
    const db = await getDb();
    const rows = await db.select().from(bondedWallets).where(inArray(bondedWallets.wallet, wallets));
    const locks = new Map(rows.map((r) => [r.wallet, r.tokens]));
    for (const [i, wallet] of wallets.entries()) {
      const r = lockStanding(locks.get(wallet) ?? null, weekly, states[i].amount - states[i].pendingWithdraw);
      if (r.change === "drop") {
        await db.delete(bondedWallets).where(eq(bondedWallets.wallet, wallet));
      } else if (r.change === "lower") {
        await db.update(bondedWallets).set({ tokens: r.saveTokens, updatedAt: new Date() }).where(eq(bondedWallets.wallet, wallet));
      } else if (r.change === "insert") {
        await db.insert(bondedWallets).values({ wallet, tokens: r.saveTokens }).onConflictDoNothing();
      }
      out.set(wallet, { tokens: r.tokens, locked: r.locked });
    }
  } catch (e) {
    console.error("bond lock failed", e);
    for (const wallet of wallets) out.set(wallet, { tokens: weekly, locked: false });
  }
  return out;
}

/**
 * Where each wallet stands, read now, keyed by lowercased wallet. Empty while the bond is off. Throws if the chain or
 * the weekly price can't be read, so callers never cache a wrong "not bonded".
 */
export async function readWalletBonds(wallets: string[]): Promise<Record<string, WalletBond>> {
  const bond = bondContract();
  if (!bond || wallets.length === 0) return {};
  const settings = await cachedSettings(bond);
  const now = Math.floor(Date.now() / 1000);
  const unique = [...new Set(wallets.filter((w) => isAddress(w)).map((w) => w.toLowerCase()))];
  if (unique.length === 0) return {};
  const [states, weekly] = await Promise.all([Promise.all(unique.map((w) => readBondState(bond, w))), weeklyBondTokens(settings)]);
  const held = await applyLocks(unique, states, weekly);
  return Object.fromEntries(unique.map((w, i) => [w, describe(w, states[i], held.get(w)!.tokens, held.get(w)!.locked, now)]));
}

/**
 * One wallet's standing for its dashboard, read now. `heldBySlash` says whether an open slash is holding back the
 * withdrawal the creator asked for: the contract blocks it only when the slash was opened before the wait ended.
 * Null while the bond is off or the chain can't be read.
 */
export async function walletBondOrNull(wallet: string) {
  const bond = bondContract();
  if (!bond) return null;
  try {
    const [settings, bonds] = await Promise.all([cachedSettings(bond), readWalletBonds([wallet])]);
    const mine = bonds[wallet.toLowerCase()];
    let heldBySlash = false;
    if (mine.openSlashId > 0 && BigInt(mine.pendingWithdraw) > 0n) {
      const [, proposedAt] = await client.readContract({ address: bond, abi: bondAbi, functionName: "slashes", args: [BigInt(mine.openSlashId)] });
      heldBySlash = Number(proposedAt) < mine.withdrawReadyAt;
    }
    return { contract: bond, settings, bond: mine, heldBySlash };
  } catch (e) {
    console.error("bond read failed", e);
    return null;
  }
}

// ---------- slashes ----------

export type SlashRecord = {
  id: number;
  provider: string;
  /** Who gets the refund share. Null when the whole slash is burned. */
  payer: string | null;
  amount: string;
  /** The hash of the evidence, as stored on-chain. */
  reason: Hex;
  /** When the dispute window ends, in unix seconds. */
  executableAt: number;
  proposedTx: string;
  /** "open" slashes are waiting, ready to run or expired: see openSlashStatus(). */
  state: "open" | "executed" | "cancelled";
  refunded: string | null;
  burned: string | null;
  closedTx: string | null;
  closedAt: number | null;
  evidence: SlashEvidence | null;
};

// The chain's public RPC answers a search this wide for one contract; a refusal for the range is split in two.
const LOG_RANGE = 5_000_000n;

type BondLog = Awaited<ReturnType<typeof slashLogs>>[number];

function slashLogs(bond: Address, fromBlock: bigint, toBlock: bigint) {
  return client.getLogs({
    address: bond,
    events: bondAbi.filter((x) => x.type === "event"),
    fromBlock,
    toBlock,
    strict: true,
  });
}

async function logsIn(bond: Address, from: bigint, to: bigint): Promise<BondLog[]> {
  try {
    return await slashLogs(bond, from, to);
  } catch (e) {
    const said = `${(e as { details?: string }).details ?? (e as Error).message}`;
    if ((e as { status?: number }).status === 429 || /too many requests|rate.?limit/i.test(said)) throw e;
    if (to - from < 500n || !/exceed|limit|too many|spans|allowed|range/i.test(said)) throw e;
    const mid = from + (to - from) / 2n;
    return [...(await logsIn(bond, from, mid)), ...(await logsIn(bond, mid + 1n, to))];
  }
}

async function readSlashes(bond: Address, startBlock: string): Promise<SlashRecord[]> {
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const logs: BondLog[] = [];
  for (let from = BigInt(startBlock); from <= latest; from += LOG_RANGE) {
    const to = from + LOG_RANGE - 1n < latest ? from + LOG_RANGE - 1n : latest;
    logs.push(...(await logsIn(bond, from, to)));
  }
  logs.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));

  const times = new Map<bigint, number>();
  const timeOf = async (block: bigint) => {
    let t = times.get(block);
    if (t === undefined) {
      t = Number((await client.getBlock({ blockNumber: block })).timestamp);
      times.set(block, t);
    }
    return t;
  };

  const byId = new Map<number, SlashRecord>();
  for (const log of logs) {
    const id = Number(log.args.id);
    if (log.eventName === "SlashProposed") {
      const payer = log.args.payer.toLowerCase();
      byId.set(id, {
        id,
        provider: log.args.provider.toLowerCase(),
        payer: /^0x0{40}$/.test(payer) ? null : payer,
        amount: log.args.amount.toString(),
        reason: log.args.reason,
        executableAt: Number(log.args.executableAt),
        proposedTx: log.transactionHash,
        state: "open",
        refunded: null,
        burned: null,
        closedTx: null,
        closedAt: null,
        evidence: SLASH_EVIDENCE[id] ?? null,
      });
      continue;
    }
    const slash = byId.get(id);
    if (!slash) continue;
    slash.closedTx = log.transactionHash;
    slash.closedAt = await timeOf(log.blockNumber);
    if (log.eventName === "SlashExecuted") {
      slash.state = "executed";
      slash.refunded = log.args.refunded.toString();
      slash.burned = log.args.burned.toString();
    } else {
      slash.state = "cancelled";
    }
  }
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

const cachedSlashes = unstable_cache(readSlashes, ["bond-slashes"], { revalidate: 300, tags: [BOND_TAG] });

/**
 * Every slash ever opened, newest first, kept for 5 minutes. Empty while the bond is off. Throws if the chain can't
 * be read or the start block isn't set, so a page can say the list is unavailable instead of showing none.
 */
export async function getSlashes(): Promise<SlashRecord[]> {
  const bond = bondContract();
  if (!bond) return [];
  const startBlock = process.env.PROVIDER_BOND_START_BLOCK?.trim();
  if (!startBlock || !/^\d+$/.test(startBlock)) throw new Error("PROVIDER_BOND_START_BLOCK is not set");
  return cachedSlashes(bond, startBlock);
}

/** getSlashes, or null when the list can't be read, for pages that still render without it. */
export async function slashesOrNull() {
  try {
    return await getSlashes();
  } catch (e) {
    console.error("bond slashes failed", e);
    return null;
  }
}
