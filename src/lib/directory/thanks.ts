import { GLOAM_VAULT } from "@/lib/payments/gloam-check";
import { internalWallets } from "@/lib/directory/track-record";

// The numbers on /thanks: everyone who paid for a call since launch, counted from the gateways' own paid calls
// (gateway_calls). The same rules as the track record (track-record.ts), but over all time and across every listed
// API, so a wallet that paid three APIs is one payer here. Kept free of server-only imports so it can be tested on
// its own; the database read is thanksFresh() in queries.ts.

/** A listed, active gateway: who runs it and where its payments go. */
export type ThanksGateway = { id: number; owner: string; payTo: string | null };
/** One wallet's settled payments to one gateway on one UTC day ("2026-11-03"). */
export type PayerDay = { gatewayId: number; payer: string; day: string; calls: number };
/** One gateway's settled calls since launch, and when the first one was. */
export type GatewaySettled = { gatewayId: number; settled: number; first: Date | string | null };

export type Thanks = {
  /** Calls whose payment settled on-chain, since launch. */
  paidCalls: number;
  /** Different outside wallets that paid: not the API's own wallets, not the team's test wallets. */
  payers: number;
  /** Payers whose payments settled on 2 or more different days. */
  cameBack: number;
  /** Settled calls paid privately through Gloam, whose payer can't be seen. */
  privateCalls: number;
  /** Listed, active APIs. */
  apis: number;
  /** Different wallets that run them. */
  creators: number;
  /** When the first paid call settled, ISO 8601; null before any. */
  firstPaidAt: string | null;
};

export function summarizeThanks(gateways: ThanksGateway[], payerDays: PayerDay[], settled: GatewaySettled[], internal = internalWallets()): Thanks {
  const own = new Map(gateways.map((g) => [g.id, new Set([g.owner, g.payTo].filter((a): a is string => !!a).map((a) => a.toLowerCase()))]));
  const vault = GLOAM_VAULT.toLowerCase();
  const daysByPayer = new Map<string, Set<string>>();
  let privateCalls = 0;
  for (const p of payerDays) {
    const mine = own.get(p.gatewayId);
    if (!mine) continue; // a gateway that isn't listed any more
    const a = p.payer.toLowerCase();
    if (a === vault) privateCalls += p.calls;
    else if (!mine.has(a) && !internal.has(a)) {
      const days = daysByPayer.get(a) ?? new Set<string>();
      days.add(p.day);
      daysByPayer.set(a, days);
    }
  }
  let paidCalls = 0;
  let first: number | null = null;
  for (const s of settled) {
    if (!own.has(s.gatewayId)) continue;
    paidCalls += s.settled;
    const at = s.first ? new Date(s.first).getTime() : null;
    if (at !== null && (first === null || at < first)) first = at;
  }
  return {
    paidCalls,
    payers: daysByPayer.size,
    cameBack: [...daysByPayer.values()].filter((days) => days.size >= 2).length,
    privateCalls,
    apis: gateways.length,
    creators: new Set(gateways.map((g) => g.owner.toLowerCase())).size,
    firstPaidAt: first === null ? null : new Date(first).toISOString(),
  };
}

// The homepage's thank-you line: shown from Thanksgiving (Thursday November 26, 2026) through the Monday after, UTC.
export const THANKS_BANNER = { from: Date.UTC(2026, 10, 26), until: Date.UTC(2026, 11, 1) };

export const thanksBannerOn = (now = Date.now()) => now >= THANKS_BANNER.from && now < THANKS_BANNER.until;
