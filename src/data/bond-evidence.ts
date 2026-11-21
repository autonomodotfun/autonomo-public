// The evidence published for each slash of a provider bond, by slash id.
//
// A slash carries a `reason` on-chain: the keccak256 hash of its evidence file (the failed calls and the payment
// transactions). Publishing a slash means adding it here with a summary and a link to that file, so anyone can hash the
// file and compare it with the chain. /bond shows a slash without an entry as "evidence not published yet".
//
// When the payer is Autonomo's refund wallet (several agents lost money), `refunds` lists the transfers that passed
// the refund on to each of them.

export type SlashEvidence = {
  /** One or two plain sentences: what the API did not deliver. */
  summary: string;
  /** Where the evidence file can be read. */
  url?: string;
  /** Transactions that passed the refund on to each payer, when the slash named the refund wallet. */
  refunds?: string[];
};

export const SLASH_EVIDENCE: Record<number, SlashEvidence> = {};
