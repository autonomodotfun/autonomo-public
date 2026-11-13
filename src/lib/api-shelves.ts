// Autonomo's own APIs, grouped by the question they answer: about a token, a wallet or a transaction. The Explore
// page, the Official APIs docs page and /llms.txt all group from this one list, so they can't drift apart.
// A new official API needs one line in SHELF_OF. A gateway that isn't listed there lands on the last shelf.

export type ShelfId = "tokens" | "wallets" | "transactions" | "web" | "partners" | "other";

export type Shelf = { id: ShelfId; title: string; about: string; onchain: boolean };

export const SHELVES: Shelf[] = [
  { id: "tokens", title: "Tokens", about: "Find a token, price it and check it before buying", onchain: true },
  { id: "wallets", title: "Wallets", about: "What a wallet holds and what it has done", onchain: true },
  { id: "transactions", title: "Transactions", about: "What a transaction did, whether a payment settled, and what gas costs", onchain: true },
  { id: "web", title: "Web and x402", about: "Check a website or a paid API before relying on it, and read pages", onchain: false },
  { id: "partners", title: "Partner tools", about: "Built on a partner's public data", onchain: false },
  { id: "other", title: "Other tools", about: "Everything else an agent can pay for here", onchain: false },
];

// Within a shelf the order runs from the quick look to the deep one.
const SHELF_OF: Record<string, ShelfId> = {
  "new-launches": "tokens",
  "token-lookup": "tokens",
  "token-price": "tokens",
  "token-risk": "tokens",
  "holders-bundles": "tokens",
  "wallet-portfolio": "wallets",
  "dev-wallet": "wallets",
  "tx-explainer": "transactions",
  "payment-check": "transactions",
  "gas-now": "transactions",
  "ostrapad-offer-finder": "partners",
  "endpoint-health": "web",
  "website-check": "web",
  "page-reader": "web",
};

const ORDER = Object.keys(SHELF_OF);

/** Sorts APIs onto their shelves, in shelf order, leaving out shelves with nothing on them. */
export function shelve<T extends { slug: string }>(apis: T[]): { shelf: Shelf; apis: T[] }[] {
  const rank = (slug: string) => {
    const i = ORDER.indexOf(slug);
    return i === -1 ? ORDER.length : i;
  };
  return SHELVES.map((shelf) => ({
    shelf,
    apis: apis.filter((a) => (SHELF_OF[a.slug] ?? "other") === shelf.id).sort((a, b) => rank(a.slug) - rank(b.slug)),
  })).filter((g) => g.apis.length > 0);
}
