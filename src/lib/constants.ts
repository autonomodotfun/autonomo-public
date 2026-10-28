// Plain constants shared by server and client code (no database imports here).
export const CATEGORIES = [
  "service",
  "agent",
  "facilitator",
  "sdk",
  "extension",
  "tooling",
  "wallet",
  "explorer",
  "infrastructure",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const TOKEN = {
  symbol: "$AUTONOMO",
  address: "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96",
  decimals: 18,
  // Robinhood Chain mainnet (Arbitrum Orbit), CAIP-2 id used by x402.
  network: "eip155:4663",
  chainName: "Robinhood Chain",
} as const;
