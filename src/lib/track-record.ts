import { GLOAM_VAULT } from "@/lib/gloam-check";

// The public track record of each Autonomo gateway, built from its own paid calls (see gateway_calls). Kept free of
// server-only imports so the summary can be tested on its own; the database read is trackRecords() in queries.ts.
//
// Payers who aren't outside customers are left out of the payer counts: the API's own wallets (owner and pay-to, since
// a creator can pay their own API and get the money back) and the team's test wallets. The Playground wallet, which
// the Telegram bot also pays from, is counted: community users ask questions there, so it counts as one outside payer.
// Gloam cash-outs all come from Gloam's vault, so they are counted as private calls instead of as one payer.

export const TRACK_RECORD_DAYS = 30;
/** Below this many outside payers in the window, an API is shown as New instead of with payer counts. */
export const MIN_OUTSIDE_PAYERS = 3;
/** Fewer paid attempts than this, and the success rate and speed aren't shown yet. */
export const MIN_CALLS = 5;

/** Autonomo's own test wallets, kept out of outside payers. Comma-separated in TRACK_RECORD_EXCLUDE. */
export function internalWallets(): Set<string> {
  const listed = (process.env.TRACK_RECORD_EXCLUDE ?? "").split(",");
  return new Set(listed.map((a) => a.trim().toLowerCase()).filter(Boolean));
}

/** The wallet that manages the official APIs, so their gateways can be picked out. */
export const OFFICIAL_OWNER = "0x0870df267e76ce27f81ea43273e152d0faefaa7a";

/**
 * One gateway's calls that carried a payment. attempts and answered leave out refused payments (402); settled,
 * refused and failed are in the window, settledAllTime since launch.
 */
export type CallTotals = {
  attempts: number;
  answered: number;
  medianMs: number | null;
  settled: number;
  refused: number;
  failed: number;
  settledAllTime: number;
};
/** A wallet that paid this gateway, and on how many different days (UTC) a payment settled. */
export type PayerDays = { payer: string; days: number; calls: number };

export type TrackRecord = {
  /** When the gateway was created, ISO 8601. */
  liveSince: string;
  windowDays: number;
  /** Fewer than MIN_OUTSIDE_PAYERS outside payers in the window. */
  isNew: boolean;
  outsidePayers: number;
  /** Outside payers whose payments settled on 2 or more different days. */
  repeatPayers: number;
  /** Settled calls paid privately through Gloam, whose payer can't be seen. */
  privateCalls: number;
  /** Calls with a valid payment (not refused). */
  paidCalls: number;
  /** Calls whose payment settled on-chain: the payer was charged. */
  settledCalls: number;
  /** Payments refused before the API was called (402): invalid, too low, expired or not enough balance. */
  refusedCalls: number;
  /** Valid payments the API didn't answer properly (5xx); the payer isn't charged. */
  failedCalls: number;
  settledAllTime: number;
  /** Share of paid calls the API answered without a server error, 0 to 1; null until MIN_CALLS. */
  successRate: number | null;
  /** Median response time of settled calls, in ms; null until MIN_CALLS. */
  medianMs: number | null;
};

export function summarize(
  g: { owner: string; payTo: string | null; createdAt: Date | string },
  totals: CallTotals,
  payers: PayerDays[],
  internal = internalWallets(),
): TrackRecord {
  const own = new Set([g.owner, g.payTo].filter((a): a is string => !!a).map((a) => a.toLowerCase()));
  const vault = GLOAM_VAULT.toLowerCase();
  let outsidePayers = 0;
  let repeatPayers = 0;
  let privateCalls = 0;
  for (const p of payers) {
    const a = p.payer.toLowerCase();
    if (a === vault) privateCalls += p.calls;
    else if (!own.has(a) && !internal.has(a)) {
      outsidePayers++;
      if (p.days >= 2) repeatPayers++;
    }
  }
  const enough = totals.attempts >= MIN_CALLS;
  return {
    liveSince: new Date(g.createdAt).toISOString(),
    windowDays: TRACK_RECORD_DAYS,
    isNew: outsidePayers < MIN_OUTSIDE_PAYERS,
    outsidePayers,
    repeatPayers,
    privateCalls,
    paidCalls: totals.attempts,
    settledCalls: totals.settled,
    refusedCalls: totals.refused,
    failedCalls: totals.failed,
    settledAllTime: totals.settledAllTime,
    successRate: enough ? totals.answered / totals.attempts : null,
    medianMs: enough && totals.medianMs !== null ? Math.round(totals.medianMs) : null,
  };
}
