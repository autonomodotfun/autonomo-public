import { and, eq, gte, lt, ne, or, sql } from "drizzle-orm";
import { schema, type DB } from "@/db";
import { normalizeRefCode, refCodeError } from "@/lib/rewards/rewards-rules";

// The rewards' rows in the database (tables ref_codes and rewards_calls in src/db/schema.ts). The rules are in
// rewards-rules.ts; this file only saves rows and reads them back, so it can be tested against a real database.

const { refCodes, rewardsCalls, gateways } = schema;

/** The wallet a code is registered to, lowercased, or null when nobody has registered it. */
export async function refCodeWallet(db: DB, code: string): Promise<string | null> {
  const [row] = await db.select({ wallet: refCodes.wallet }).from(refCodes).where(eq(refCodes.code, code)).limit(1);
  return row?.wallet ?? null;
}

/** The code a wallet registered, or null. */
export async function refCodeOf(db: DB, wallet: string): Promise<string | null> {
  const [row] = await db.select({ code: refCodes.code }).from(refCodes).where(eq(refCodes.wallet, wallet.toLowerCase())).limit(1);
  return row?.code ?? null;
}

export type RegisterResult = { ok: true; code: string } | { ok: false; error: string };

/**
 * Registers a code for a wallet. One code per wallet and one wallet per code, kept by the table itself, so two
 * requests at the same moment can't both win. A code can't be changed afterwards: calls already made with it are on
 * the record under that name.
 */
export async function registerRefCode(db: DB, wallet: string, raw: string): Promise<RegisterResult> {
  const problem = refCodeError(raw);
  if (problem) return { ok: false, error: problem };
  const code = normalizeRefCode(raw)!;
  const owner = wallet.toLowerCase();
  const added = await db.insert(refCodes).values({ code, wallet: owner }).onConflictDoNothing().returning({ code: refCodes.code });
  if (added.length) return { ok: true, code };
  const mine = await refCodeOf(db, owner);
  if (mine === code) return { ok: true, code };
  if (mine) return { ok: false, error: `This wallet already has the code ${mine}. A code can't be changed.` };
  return { ok: false, error: "That code is taken." };
}

export type RewardsCall = {
  gatewayId: number;
  tx: string;
  payer: string;
  official: boolean;
  refCode: string | null;
  payerHasPass: boolean | null;
  passMinTokens: number | null;
  /** Only given by tests; a real call is stamped by the database. */
  at?: Date;
};

/** Saves what the rewards need about one settled payment. A payment already on the record is left as it is. */
export async function saveRewardsCall(db: DB, call: RewardsCall) {
  await db
    .insert(rewardsCalls)
    .values({
      gatewayId: call.gatewayId,
      tx: call.tx.toLowerCase(),
      payer: call.payer.toLowerCase(),
      official: call.official,
      refCode: call.refCode,
      payerHasPass: call.payerHasPass,
      passMinTokens: call.passMinTokens,
      ...(call.at ? { createdAt: call.at } : {}),
    })
    .onConflictDoNothing();
}

const count = sql<number>`count(*)::int`;
const payers = sql<number>`count(distinct ${rewardsCalls.payer})::int`;

export type WalletCounts = {
  /** Calls this wallet paid official APIs for, and how many of them while it held the Agent Pass. */
  paid: { officialCalls: number; withPass: number };
  /** Calls other wallets made with this wallet's ref code. Null when it has no code. */
  brought: { calls: number; payers: number } | null;
  /** Calls other wallets paid this wallet's own APIs for. Null when it has launched none. */
  earned: { calls: number; payers: number } | null;
};

/**
 * What a wallet has on the record between two times. Counts only: what a call is worth in tokens is settled at the
 * end of the month, from that month's price, so no amount is shown before then.
 */
export async function walletCounts(db: DB, wallet: string, code: string | null, from: Date, to: Date): Promise<WalletCounts> {
  const me = wallet.toLowerCase();
  const inWindow = and(gte(rewardsCalls.createdAt, from), lt(rewardsCalls.createdAt, to));
  const mine = or(eq(gateways.owner, me), eq(gateways.payTo, me));

  const [[paid], brought, [own], [earned]] = await Promise.all([
    db
      .select({ officialCalls: count, withPass: sql<number>`count(*) filter (where ${rewardsCalls.payerHasPass})::int` })
      .from(rewardsCalls)
      .where(and(eq(rewardsCalls.payer, me), rewardsCalls.official, inWindow)),
    code
      ? db.select({ calls: count, payers }).from(rewardsCalls).where(and(eq(rewardsCalls.refCode, code), ne(rewardsCalls.payer, me), inWindow))
      : Promise.resolve(null),
    db.select({ n: count }).from(gateways).where(mine),
    // An API's own wallets paying it are left out: a creator gets that money back, so it is not outside revenue.
    db
      .select({ calls: count, payers })
      .from(rewardsCalls)
      .innerJoin(gateways, eq(gateways.id, rewardsCalls.gatewayId))
      .where(and(mine, sql`not ${rewardsCalls.official}`, ne(rewardsCalls.payer, gateways.owner), sql`${rewardsCalls.payer} <> coalesce(${gateways.payTo}, '')`, inWindow)),
  ]);

  return {
    paid: { officialCalls: paid?.officialCalls ?? 0, withPass: paid?.withPass ?? 0 },
    brought: brought ? { calls: brought[0]?.calls ?? 0, payers: brought[0]?.payers ?? 0 } : null,
    earned: (own?.n ?? 0) > 0 ? { calls: earned?.calls ?? 0, payers: earned?.payers ?? 0 } : null,
  };
}
