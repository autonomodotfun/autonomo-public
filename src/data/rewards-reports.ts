// The monthly rewards runs, newest first, for /rewards. One entry is added by hand after each run, with links to the
// two files that let anyone check it: the report (what came in, what each pool paid, burned and carried over) and
// the payouts (every wallet and amount). The first run is on January 1, 2027, for December 2026.

export type RewardsReport = {
  /** The month the calls were made in, as "2026-12". */
  month: string;
  /** When the payouts were sent, as "2027-01-01". */
  paidOn: string;
  /** Whole tokens. */
  inflow: number;
  paid: number;
  burned: number;
  carriedOver: number;
  /** The Safe transaction that sent the payouts. */
  tx: string;
  report: string;
  payouts: string;
};

export const REWARDS_REPORTS: RewardsReport[] = [];
