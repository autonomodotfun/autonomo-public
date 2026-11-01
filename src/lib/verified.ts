import "server-only";
import { createPublicClient, defineChain, erc20Abi, formatUnits, http, type Hex } from "viem";
import { TOKEN } from "@/lib/constants";

// Launching an API is free. A wallet holding at least the minimum of $AUTONOMO shows as Verified on its APIs; the
// tokens stay in the wallet, and the badge goes away if the balance drops below the minimum. Read live from the chain,
// so nothing is stored. Verified says the provider holds the token, not that the API has been reviewed.
//
// Env: VERIFIED_MIN_AUTONOMO   Whole tokens required (default 100000). 0 turns Verified off.

const DEFAULT_MINIMUM = 100_000n;

const client = createPublicClient({
  chain: defineChain({
    id: TOKEN.chainId,
    name: TOKEN.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [TOKEN.rpcUrl] } },
  }),
  transport: http(process.env.ROBINHOOD_RPC_URL || undefined, { timeout: 8_000 }),
});

/** Whole $AUTONOMO needed for Verified. */
export function verifiedMinimum() {
  const raw = process.env.VERIFIED_MIN_AUTONOMO?.trim();
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : DEFAULT_MINIMUM;
}

export function verifiedEnabled() {
  return verifiedMinimum() > 0n;
}

export const verifiedAmount = () => verifiedMinimum().toLocaleString("en-US");

function readBalance(owner: string) {
  return client.readContract({ address: TOKEN.address as Hex, abi: erc20Abi, functionName: "balanceOf", args: [owner as Hex] });
}

const meetsMinimum = (balance: bigint) => verifiedEnabled() && balance >= verifiedMinimum() * 10n ** BigInt(TOKEN.decimals);

/** Whether a wallet holds the minimum. Throws if the balance can't be read, so callers never cache a wrong "no". */
export async function holdsMinimum(owner: string) {
  return verifiedEnabled() && meetsMinimum(await readBalance(owner));
}

/** A wallet's standing for its dashboard. `balance` is null when it couldn't be read. */
export async function verifiedStatus(owner: string) {
  try {
    const balance = await readBalance(owner);
    return {
      balance: Number(formatUnits(balance, TOKEN.decimals)).toLocaleString("en-US", { maximumFractionDigits: 0 }),
      verified: meetsMinimum(balance),
    };
  } catch (e) {
    console.error("verified check failed", e);
    return { balance: null, verified: false };
  }
}
