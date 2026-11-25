import "server-only";
import { unstable_cache } from "next/cache";
import { erc20Abi, formatUnits, isAddress, parseAbi, type Hex } from "viem";
import { getDb } from "@/db";
import { TOKEN } from "@/lib/constants";
import { client } from "@/lib/payments/pool-price";
import { REF_HEADER, REWARDS, countingWindow, holdTokensFor, normalizeRefCode } from "@/lib/rewards/rewards-rules";
import { refCodeOf, refCodeWallet, saveRewardsCall, walletCounts, type WalletCounts } from "@/lib/rewards/rewards-store";
import { weeklyPriceUsd } from "@/lib/trust/verified";

// The server side of the monthly rewards: what is noted with each paid call, the two holding minimums, the vesting
// contract's state and one wallet's standing. The rules themselves are in rewards-rules.ts.
//
// Recording runs whether or not the rewards are shown, so the first month's calls are all on the record. It is kept
// apart from the call log on purpose: if its table can't be written, a paid call and its log are unharmed.
//
// Env:
//   REWARDS_ENABLED      "1" shows /rewards and the ref code panel on the dashboard. Without it both are hidden.
//   AGENT_PASS_USD       Dollar value an agent holds for the Agent Pass (default 25).
//   INTEGRATOR_MIN_USD   Dollar value an integrator holds to be paid (default 75).

export const rewardsEnabled = () => process.env.REWARDS_ENABLED?.trim() === "1";

/** The vesting contract that releases the rewards tokens, and the 2-of-2 Safe it pays into. Robinhood Chain. */
export const REWARDS_VESTING = "0xF8795F9F5F92Fec042d94A8D879770C0bdE9D277";
export const REWARDS_SAFE = "0x26FB8dc4550893e832e3238637dd93D2B6beB6B4";

function usd(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  return raw && /^\d+(\.\d+)?$/.test(raw) && Number(raw) > 0 ? Number(raw) : fallback;
}

export const passUsd = () => usd("AGENT_PASS_USD", REWARDS.passUsd);
export const integratorUsd = () => usd("INTEGRATOR_MIN_USD", REWARDS.integratorUsd);

export type Minimums = { passUsd: number; passTokens: number; integratorUsd: number; integratorTokens: number };

/**
 * This week's holding minimums in whole tokens, at the same weekly price Verified uses (the previous week's average),
 * so they don't move with the market. Throws only when no weekly price can be read.
 */
export async function minimums(): Promise<Minimums> {
  const price = await weeklyPriceUsd();
  return { passUsd: passUsd(), passTokens: holdTokensFor(passUsd(), price), integratorUsd: integratorUsd(), integratorTokens: holdTokensFor(integratorUsd(), price) };
}

export async function minimumsOrNull() {
  return minimums().catch((e) => (console.error("rewards minimums failed", e), null));
}

const WEI = 10n ** BigInt(TOKEN.decimals);

function balanceOf(wallet: string) {
  return client.readContract({ address: TOKEN.address as Hex, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Hex] });
}

// ---------- what is noted with each paid call ----------

const PASS_TTL_MS = 5 * 60_000;
const REF_TTL_MS = 60_000;
// Kept per server instance, like gateway rows: a wallet that pays often is read from the chain once every 5 minutes.
const passes = new Map<string, { until: number; has: boolean; minTokens: number }>();
const codes = new Map<string, { until: number; wallet: string | null }>();

/** Whether a wallet holds the Agent Pass minimum right now. Null when the chain or the price can't be read. */
export async function passCheck(wallet: string): Promise<{ has: boolean; minTokens: number } | null> {
  const key = wallet.toLowerCase();
  const hit = passes.get(key);
  if (hit && hit.until > Date.now()) return { has: hit.has, minTokens: hit.minTokens };
  try {
    const [{ passTokens }, balance] = await Promise.all([minimums(), balanceOf(key)]);
    const has = balance >= BigInt(passTokens) * WEI;
    if (passes.size > 5_000) passes.clear();
    passes.set(key, { until: Date.now() + PASS_TTL_MS, has, minTokens: passTokens });
    return { has, minTokens: passTokens };
  } catch (e) {
    console.error("agent pass check failed", e);
    return null;
  }
}

/** The wallet a ref code is registered to, kept for a minute. Null for a code nobody registered. */
async function registeredTo(code: string) {
  const hit = codes.get(code);
  if (hit && hit.until > Date.now()) return hit.wallet;
  const wallet = await refCodeWallet(await getDb(), code);
  if (codes.size > 5_000) codes.clear();
  codes.set(code, { until: Date.now() + REF_TTL_MS, wallet });
  return wallet;
}

/** Called after a code is registered, so this server sees it at once. Others see it within a minute. */
export const forgetRefCode = (code: string) => void codes.delete(code);

/** The ref code a request carries, as the client sent it. Checked against the registered codes when the call is noted. */
export const refHeaderOf = (request: Request) => request.headers.get(REF_HEADER);

/**
 * Notes what the rewards need about a payment that settled: the registered ref code it came with, and whether the
 * payer held the Agent Pass. Runs after the answer is sent. It never throws: nothing about a paid call depends on it.
 * A code nobody registered is ignored, and the call counts as any other. `hiddenPayer` is a private Gloam payment,
 * whose payer is Gloam's vault: it can bring an integrator a call, but nobody can be given cashback for it.
 */
export async function noteRewardsCall(call: { gatewayId: number; official: boolean; tx: string | null; payer: string | null; refHeader: string | null; hiddenPayer?: boolean }) {
  try {
    if (!call.tx || !call.payer) return;
    const code = normalizeRefCode(call.refHeader);
    const [owner, pass] = await Promise.all([code ? registeredTo(code) : null, call.hiddenPayer ? null : passCheck(call.payer)]);
    await saveRewardsCall(await getDb(), {
      gatewayId: call.gatewayId,
      tx: call.tx,
      payer: call.payer,
      official: call.official,
      refCode: code && owner ? code : null,
      payerHasPass: call.hiddenPayer ? false : (pass?.has ?? null),
      passMinTokens: pass?.minTokens ?? null,
    });
  } catch (e) {
    console.error("rewards note failed", e);
  }
}

// ---------- the vesting contract ----------

const vestingAbi = parseAbi([
  "function start() view returns (uint256)",
  "function duration() view returns (uint256)",
  "function released(address token) view returns (uint256)",
  "function releasable(address token) view returns (uint256)",
]);

/** Amounts are whole-token text, so the copy that is kept can be saved as JSON. */
export type VestingStatus = { start: number; end: number; held: string; released: string; releasable: string; safeHolds: string };

async function readVesting(): Promise<VestingStatus> {
  const at = { address: REWARDS_VESTING as Hex, abi: vestingAbi } as const;
  const token = TOKEN.address as Hex;
  const [start, duration, released, releasable, held, safeHolds] = await Promise.all([
    client.readContract({ ...at, functionName: "start" }),
    client.readContract({ ...at, functionName: "duration" }),
    client.readContract({ ...at, functionName: "released", args: [token] }),
    client.readContract({ ...at, functionName: "releasable", args: [token] }),
    balanceOf(REWARDS_VESTING),
    balanceOf(REWARDS_SAFE),
  ]);
  const whole = (v: bigint) => formatUnits(v, TOKEN.decimals);
  return { start: Number(start), end: Number(start + duration), held: whole(held), released: whole(released), releasable: whole(releasable), safeHolds: whole(safeHolds) };
}

const cachedVesting = unstable_cache(readVesting, ["rewards-vesting"], { revalidate: 300 });

/** The vesting contract as read from the chain, kept for 5 minutes. Null when it can't be read. */
export async function vestingOrNull() {
  return cachedVesting().catch((e) => (console.error("rewards vesting read failed", e), null));
}

// ---------- one wallet ----------

export type WalletRewards = {
  wallet: string;
  /** Whole tokens held on Robinhood Chain. Null when the balance couldn't be read. */
  holds: number | null;
  minimums: Minimums | null;
  hasPass: boolean | null;
  meetsIntegratorMinimum: boolean | null;
  refCode: string | null;
  /** The stretch of this month whose calls are counted, and whether counting has started. */
  window: { from: string; to: string; started: boolean };
  counts: WalletCounts;
};

/** One wallet's standing: what it holds against the two minimums, its ref code, and its counted calls this month. */
export async function walletRewards(address: string): Promise<WalletRewards | null> {
  if (!isAddress(address)) return null;
  const wallet = address.toLowerCase();
  const db = await getDb();
  const window = countingWindow(Date.now());
  const [balance, mins, refCode] = await Promise.all([
    balanceOf(wallet).catch((e) => (console.error("rewards balance failed", e), null)),
    minimumsOrNull(),
    refCodeOf(db, wallet),
  ]);
  const counts = await walletCounts(db, wallet, refCode, window.from, window.to);
  const meets = (tokens: number | undefined) => (balance === null || tokens === undefined ? null : balance >= BigInt(tokens) * WEI);
  return {
    wallet,
    holds: balance === null ? null : Math.floor(Number(formatUnits(balance, TOKEN.decimals))),
    minimums: mins,
    hasPass: meets(mins?.passTokens),
    meetsIntegratorMinimum: meets(mins?.integratorTokens),
    refCode,
    window: { from: window.from.toISOString(), to: window.to.toISOString(), started: window.started },
    counts,
  };
}
