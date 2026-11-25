// The monthly rewards: who earns, the split and the limits, as agreed with the advisor on November 20, 2026.
// Kept free of server-only imports so it can be tested on its own; the database and chain reads are in rewards.ts.
//
// Where the tokens come from: a vesting contract releases 1% of the supply over 180 days from December 1, 2026 into
// the Rewards Safe, and 30% of the $AUTONOMO the official APIs receive is added each month. Once a month the inflow
// is split into four pools. The amounts are worked out by a calculator from a file of that month's paid calls, and
// that file and the payouts are published, so anyone can check them.
//
// The rule behind every number: a reward on a call is always smaller than what that call cost for good. A call to a
// creator's API costs the 5% burn for good, so creator plus integrator rewards stay under 5%. A call to an official
// API costs all of it (it goes to Autonomo), so cashback plus integrator rewards stay under 100%. Paying your own
// calls to collect rewards therefore always loses money, however many wallets are used.

export const REWARDS = {
  /** Each month's inflow, in percent. */
  split: { creators: 40, integrators: 20, cashback: 20, burn: 20 },
  /** A creator earns at most this share of what outside agents paid their APIs. */
  creatorRate: 0.025,
  /** An integrator earns at most these shares of the calls made with its ref code. */
  integratorRateOfficial: 0.2,
  integratorRateExternal: 0.015,
  /** An agent holding the Agent Pass gets this share of what it paid official APIs back. */
  cashbackRate: 0.1,
  creatorMinPayers: 5,
  creatorMinCalls: 20,
  integratorMinPayers: 5,
  /** Nobody takes more than this share of a pool; for cashback, more than this share per wallet. */
  poolCapShare: 0.3,
  cashbackWalletCapShare: 0.05,
  /** A smaller payout is not sent. It stays in its pool. */
  minPayoutTokens: 1_000,
  /** What the pools carry over above this is burned. */
  carryCapTokens: 5_000_000,
  /** Calls count from this moment. The first payout is for December's calls. */
  countingStarts: "2026-12-01T00:00:00Z",
  firstPayout: "2027-01-01",
  /** Dollar values to hold, turned into tokens once a week like Verified. Overridden by AGENT_PASS_USD and INTEGRATOR_MIN_USD. */
  passUsd: 25,
  integratorUsd: 75,
} as const;

/** The header a client sends with a paid call to name who brought it. */
export const REF_HEADER = "x-autonomo-ref";

const REF_CODE = /^[A-Z0-9]{3,20}$/;

/** A ref code as it is stored and compared: trimmed, upper case, 3 to 20 letters or digits. Null for anything else. */
export function normalizeRefCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return REF_CODE.test(code) ? code : null;
}

// Names nobody can register for themselves: ours, our partners' and the tools agents are built with. A partner's code
// is given to its own wallet by hand, so nobody else can collect the calls its name brings.
export const RESERVED_REF_CODES = new Set([
  "AUTONOMO", "AUTONOMOFUN", "OFFICIAL", "ADMIN", "TEAM", "TEST", "NONE", "NULL",
  "OAK", "OAKAGENTKIT", "ELIZA", "ELIZAOS", "LANGCHAIN", "LANGGRAPH", "MCP", "X402", "COINBASE", "BASE", "ROBINHOOD",
  "PRIORS", "TOKYO", "TOKYOFUTURO", "GLOAM", "BORRO", "STOA", "QHOOKS", "RAETO", "ORBIO",
  "CLAUDE", "ANTHROPIC", "OPENAI", "CHATGPT", "GEMINI", "CURSOR", "CODEX",
]);

/** Why a code typed into the form can't be registered, or null when it can. */
export function refCodeError(raw: string): string | null {
  const code = normalizeRefCode(raw);
  if (!code) return "A code is 3 to 20 letters or digits, with no spaces.";
  if (RESERVED_REF_CODES.has(code)) return "That code is reserved. If it is your project's name, ask us on Telegram.";
  return null;
}

const HOLD_STEP_TOKENS = 10_000;

/** Whole tokens worth `usd` at a price, rounded to the nearest 10,000 and never under 10,000. */
export function holdTokensFor(usd: number, priceUsd: number) {
  if (!(usd > 0) || !(priceUsd > 0)) throw new Error("a holding minimum needs a dollar value and a price above zero");
  return Math.max(HOLD_STEP_TOKENS, Math.round(usd / priceUsd / HOLD_STEP_TOKENS) * HOLD_STEP_TOKENS);
}

/** The first moment of the UTC month a time is in, and of the month after it. */
export function monthOf(now: number): { start: Date; end: Date } {
  const d = new Date(now);
  return { start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) };
}

/**
 * The stretch of the current month whose calls count: from the 1st, or from the day counting starts when that is
 * later. `started` is false before that day.
 */
export function countingWindow(now: number): { from: Date; to: Date; started: boolean } {
  const { start, end } = monthOf(now);
  const first = new Date(REWARDS.countingStarts);
  return { from: start < first ? first : start, to: end, started: now >= first.getTime() };
}

/** What a vesting wallet has let go of by a time: nothing before its start, everything after its end, a straight line between. */
export function vestedBy(total: bigint, startS: number, durationS: number, nowS: number): bigint {
  if (nowS <= startS) return 0n;
  if (durationS <= 0 || nowS >= startS + durationS) return total;
  return (total * BigInt(nowS - startS)) / BigInt(durationS);
}
