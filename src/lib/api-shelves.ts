// The APIs on Autonomo's gateways, grouped by the question they answer: about a token, a wallet or a transaction. The
// Explore page, the Official APIs docs page, the Playground and /llms.txt all group from this one list, so they can't
// drift apart. A new official API needs one line in SHELF_OF; one that isn't listed there lands on "Other tools".
// APIs other teams built and launched on Autonomo go on their own shelf, by owner, so a new one needs no change here.
import { isRetired } from "@/lib/retired";
import { OFFICIAL_OWNER } from "@/lib/track-record";

export type ShelfId = "tokens" | "wallets" | "transactions" | "web" | "partners" | "other" | "creators";

export type Shelf = { id: ShelfId; title: string; about: string; onchain: boolean };

export const SHELVES: Shelf[] = [
  { id: "tokens", title: "Tokens", about: "Find a token, price it and check it before buying", onchain: true },
  { id: "wallets", title: "Wallets", about: "What a wallet holds and what it has done", onchain: true },
  { id: "transactions", title: "Transactions", about: "What a transaction did, whether a payment settled, and what gas costs", onchain: true },
  { id: "web", title: "Web and x402", about: "Check a website or a paid API before relying on it, and read pages", onchain: false },
  { id: "partners", title: "Partner tools", about: "Built by Autonomo on a partner's public data", onchain: false },
  { id: "other", title: "Other tools", about: "Everything else an agent can pay for here", onchain: false },
  { id: "creators", title: "Creator APIs", about: "Built and run by other teams, paid through Autonomo", onchain: false },
];

// Within a shelf the order runs from the quick look to the deep one.
const SHELF_OF: Record<string, ShelfId> = {
  "new-launches": "tokens",
  "token-lookup": "tokens",
  "token-risk": "tokens",
  "holders-bundles": "tokens",
  "safe-swap": "tokens",
  "wallet-portfolio": "wallets",
  "dev-wallet": "wallets",
  "tx-explainer": "transactions",
  "payment-check": "transactions",
  "gas-now": "transactions",
  "ostrapad-offer-finder": "partners",
  "tokyo-futuro-job-finder": "partners",
  "endpoint-health": "web",
  "website-check": "web",
  "page-reader": "web",
};

const ORDER = Object.keys(SHELF_OF);

/** An API's shelf. One with an owner other than Autonomo is a creator's, whatever its slug. A list without owners
 * (the Official APIs docs page) is all Autonomo's. */
export function shelfOf(api: { slug: string; owner?: string | null }): ShelfId {
  if (api.owner != null && api.owner.toLowerCase() !== OFFICIAL_OWNER) return "creators";
  return SHELF_OF[api.slug] ?? "other";
}

/** Sorts APIs onto their shelves, in shelf order, leaving out retired APIs (src/lib/retired.ts) and shelves with nothing
 * on them. Creator APIs keep the order they came in (the oldest first, from listAutonomoGateways). */
export function shelve<T extends { slug: string; owner?: string | null }>(apis: T[]): { shelf: Shelf; apis: T[] }[] {
  const rank = (slug: string) => {
    const i = ORDER.indexOf(slug);
    return i === -1 ? ORDER.length : i;
  };
  return SHELVES.map((shelf) => ({
    shelf,
    apis: apis.filter((a) => !isRetired(a.slug) && shelfOf(a) === shelf.id).sort((a, b) => rank(a.slug) - rank(b.slug)),
  })).filter((g) => g.apis.length > 0);
}
