import "server-only";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { erc20Abi, formatUnits, parseAbi, type Hex } from "viem";
import { getDb, schema } from "@/db";
import { TOKEN } from "@/lib/constants";
import { averagePriceEth, client, ethUsd } from "@/lib/payments/pool-price";

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

/** Dollar value required for Verified. */
export function verifiedUsd() {
  const raw = process.env.VERIFIED_USD?.trim();
  return raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : DEFAULT_USD;
}

export function verifiedEnabled() {
  return verifiedUsd() > 0;
}

export const verifiedAmount = () => `$${verifiedUsd().toLocaleString("en-US")}`;

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

/**
 * This week's price in USD per token, the average of the previous full week. Falls back to last week's; throws only if
 * neither can be read. Verified and the provider bond's Bonded amount both use it.
 */
export async function weeklyPriceUsd() {
  const week = Math.floor(Date.now() / 1000 / WEEK_S);
  return cachedWeekPrice(week).catch((e) => {
    console.error("weekly price failed, using last week's", e);
    return cachedWeekPrice(week - 1);
  });
}

/** This week's requirement in whole tokens. Throws only if no weekly price can be read. */
export async function verifiedTokens() {
  return tokensFor(verifiedUsd(), await weeklyPriceUsd());
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

/** Whether an address is a contract, such as a Safe, which can receive payments but can't sign in. Null if unreadable. */
export async function isContractWallet(address: string) {
  return client.getCode({ address: address as Hex }).then((code) => Boolean(code && code !== "0x")).catch(() => null);
}

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
]);

/**
 * A Safe's signers and how many must sign, read from Robinhood Chain. Null when the address isn't a Safe there;
 * throws when the chain can't be read, so a slow RPC isn't taken as "not a Safe".
 */
export async function safeInfo(address: string) {
  const contract = await isContractWallet(address);
  if (contract === null) throw new Error("couldn't read the chain");
  if (!contract) return null;
  const at = { address: address as Hex, abi: safeAbi } as const;
  try {
    const [owners, threshold, version] = await Promise.all([
      client.readContract({ ...at, functionName: "getOwners" }),
      client.readContract({ ...at, functionName: "getThreshold" }),
      client.readContract({ ...at, functionName: "VERSION" }),
    ]);
    return { owners: owners.map((o) => o.toLowerCase()), threshold: Number(threshold), version };
  } catch {
    return null;
  }
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
