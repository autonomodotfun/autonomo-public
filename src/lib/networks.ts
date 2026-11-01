// Normalizes x402 network identifiers (v2 CAIP-2 ids and v1 short names) to one key.

type NetworkInfo = { key: string; label: string; testnet: boolean };

const NETWORKS: Record<string, NetworkInfo> = {
  "eip155:8453": { key: "base", label: "Base", testnet: false },
  "eip155:84532": { key: "base-sepolia", label: "Base Sepolia", testnet: true },
  "eip155:1": { key: "ethereum", label: "Ethereum", testnet: false },
  "eip155:10": { key: "optimism", label: "Optimism", testnet: false },
  "eip155:42161": { key: "arbitrum", label: "Arbitrum", testnet: false },
  "eip155:137": { key: "polygon", label: "Polygon", testnet: false },
  "eip155:80002": { key: "polygon-amoy", label: "Polygon Amoy", testnet: true },
  "eip155:43114": { key: "avalanche", label: "Avalanche", testnet: false },
  "eip155:43113": { key: "avalanche-fuji", label: "Avalanche Fuji", testnet: true },
  "eip155:42220": { key: "celo", label: "Celo", testnet: false },
  "eip155:11142220": { key: "celo-sepolia", label: "Celo Sepolia", testnet: true },
  "eip155:1329": { key: "sei", label: "Sei", testnet: false },
  "eip155:1328": { key: "sei-testnet", label: "Sei Testnet", testnet: true },
  "eip155:4689": { key: "iotex", label: "IoTeX", testnet: false },
  "eip155:196": { key: "xlayer", label: "X Layer", testnet: false },
  // Key kept as the CAIP-2 id so existing rows and filters keep working.
  "eip155:4663": { key: "eip155:4663", label: "Robinhood Chain", testnet: false },
  "eip155:2741": { key: "abstract", label: "Abstract", testnet: false },
  "eip155:3338": { key: "peaq", label: "peaq", testnet: false },
  "eip155:56": { key: "bnb", label: "BNB Chain", testnet: false },
  "eip155:143": { key: "monad", label: "Monad", testnet: false },
  "eip155:480": { key: "worldchain", label: "World Chain", testnet: false },
  "eip155:999": { key: "hyperevm", label: "HyperEVM", testnet: false },
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k": { key: "algorand", label: "Algorand", testnet: false },
  "xrpl:0": { key: "xrpl", label: "XRP Ledger", testnet: false },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { key: "solana", label: "Solana", testnet: false },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { key: "solana-devnet", label: "Solana Devnet", testnet: true },
};

// Networks referenced by curated entries that have no CAIP-2 id in the map above.
const EXTRA: NetworkInfo[] = [
  { key: "stellar", label: "Stellar", testnet: false },
  { key: "near", label: "NEAR", testnet: false },
  { key: "xrpl", label: "XRP Ledger", testnet: false },
  { key: "canton", label: "Canton", testnet: false },
  { key: "hpp", label: "HPP", testnet: false },
];

const BY_KEY: Record<string, NetworkInfo> = Object.fromEntries(
  [...Object.values(NETWORKS), ...EXTRA].map((n) => [n.key, n]),
);

export function normalizeNetwork(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (NETWORKS[raw]) return NETWORKS[raw].key;
  const lower = raw.toLowerCase();
  if (BY_KEY[lower]) return lower;
  return lower;
}

export function networkLabel(key: string): string {
  return BY_KEY[key]?.label ?? key.replace(/^eip155:(\d+)$/, "EVM chain $1");
}

// Name pattern for test networks; every known testnet key above matches it too.
export const TESTNET_PATTERN = "(test|sepolia|devnet|fuji|amoy|goerli)";

export function isTestnet(key: string): boolean {
  if (BY_KEY[key]) return BY_KEY[key].testnet;
  return new RegExp(TESTNET_PATTERN, "i").test(key);
}

// Stablecoins we can price in USD. Keyed by lowercased asset address.
const STABLES: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC Base
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": 6, // USDC Base Sepolia
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6, // USDC Polygon
  "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": 6, // USDC Avalanche
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC Ethereum
  epjfwdd5aufqssqem2qn1xzybapc8g4wegggkzwytdt1v: 6, // USDC Solana
  "4zmmc9srt5ri5x14gagxhahii3gnpaeerypjgzjdncdu": 6, // USDC Solana Devnet
};

/** Converts an atomic token amount to USD when the asset is a known (or clearly named) stablecoin. */
export function priceUsd(
  amount: string | null | undefined,
  asset: string | null | undefined,
  extra?: { name?: unknown; decimals?: unknown } | null,
): number | null {
  if (!amount || !/^\d+$/.test(amount)) return null;
  let decimals: number | undefined = asset ? STABLES[asset.toLowerCase()] : undefined;
  const name = typeof extra?.name === "string" ? extra.name : "";
  const isStableName = /^(usd coin|usdc|usdt|tether|usd₮|pyusd)\b/i.test(name);
  if (decimals === undefined && isStableName) {
    decimals = typeof extra?.decimals === "number" ? extra.decimals : 6;
  }
  if (decimals === undefined) return null;
  const value = Number(amount) / 10 ** decimals;
  return Number.isFinite(value) ? value : null;
}

export function formatUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (n === 0) return "Free";
  if (n < 0.01) return `$${n.toPrecision(2).replace(/0+$/, "")}`;
  return `$${n.toFixed(n < 1 ? 3 : 2).replace(/0$/, "")}`;
}
