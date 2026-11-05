import { decodeEventLog, parseAbiItem, type Hex, type PublicClient } from "viem";

// The on-chain half of a Gloam cash-out payment: what the 402 asks for, and the check of the transaction an agent
// brings back. Kept free of server-only imports so it can be tested on its own. The flow is in src/lib/gloam.ts.
//
// Gloam's vault on Robinhood Chain releases a private balance with an Unshielded event and a USDG transfer from the
// vault to the recipient. The event carries the gross amount; the recipient gets it minus the vault's fee, which can
// only change through a public 3-day timelock on the vault.

export const GLOAM_VAULT = "0x39E28Cde55CAB798874746ac52cb4B5Cc99a0194";
export const GLOAM_SCHEME = "gloam-cashout";
export const GLOAM_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
/** How long a quote's cash-out may land after the 402, in seconds. */
export const QUOTE_WINDOW_S = 600;
/** Tags make each open quote's amount unique per splitter: 1 to 9,999 USDG base units, under a cent. */
export const MAX_TAG = 9_999n;

const UNSHIELDED = parseAbiItem("event Unshielded(bytes32 indexed nullifier, address indexed asset, address indexed to, uint256 amount)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const FEE_BPS = parseAbiItem("function withdrawFeeBps() view returns (uint16)");

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The vault's current cash-out fee in basis points. */
export async function vaultFeeBps(client: PublicClient) {
  return BigInt(await client.readContract({ address: GLOAM_VAULT, abi: [FEE_BPS], functionName: "withdrawFeeBps" }));
}

/** The gross amount to cash out so that at least `price` arrives after the fee, plus the quote's tag. */
export function grossFor(price: bigint, feeBps: bigint, tag: bigint) {
  if (feeBps < 0n || feeBps >= 10_000n) throw new Error(`unexpected vault fee: ${feeBps} bps`);
  return (price * 10_000n + (10_000n - feeBps) - 1n) / (10_000n - feeBps) + tag;
}

export type CashoutQuote = { payTo: string; gross: bigint; price: bigint; issuedAt: number };

export type CashoutCheck =
  | { ok: true; received: bigint; block: bigint }
  | { ok: false; reason: string; retry?: boolean };

/**
 * Checks that `txHash` is a successful Gloam cash-out of exactly the quote's gross amount, in USDG, to the quote's
 * payTo, that payTo received at least the price from the vault in it, and that it landed inside the quote's window.
 * Whether the transaction was already used, and whether the quote belongs to this request, are checked by the caller.
 */
export async function checkCashout(client: PublicClient, txHash: Hex, q: CashoutQuote): Promise<CashoutCheck> {
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (e) {
    const missing = e instanceof Error && /not.?found|could not be found/i.test(e.message);
    return missing
      ? { ok: false, reason: "That transaction isn't on Robinhood Chain yet. Retry once it lands.", retry: true }
      : { ok: false, reason: "Robinhood Chain couldn't be read just now. Retry with the same transaction.", retry: true };
  }
  if (receipt.status !== "success") return { ok: false, reason: "That transaction failed." };

  let timestamp: bigint;
  try {
    timestamp = (await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp;
  } catch {
    return { ok: false, reason: "Robinhood Chain couldn't be read just now. Retry with the same transaction.", retry: true };
  }
  const t = Number(timestamp);
  if (t < q.issuedAt || t > q.issuedAt + QUOTE_WINDOW_S) return { ok: false, reason: "That cash-out landed outside the quote's window." };

  let matched = false;
  let received = 0n;
  for (const log of receipt.logs) {
    try {
      if (eq(log.address, GLOAM_VAULT)) {
        const e = decodeEventLog({ abi: [UNSHIELDED], data: log.data, topics: log.topics });
        if (eq(e.args.asset, GLOAM_USDG) && eq(e.args.to, q.payTo) && e.args.amount === q.gross) matched = true;
      } else if (eq(log.address, GLOAM_USDG)) {
        const e = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
        if (eq(e.args.from, GLOAM_VAULT) && eq(e.args.to, q.payTo)) received += e.args.value;
      }
    } catch {
      // Another event.
    }
  }
  if (!matched) return { ok: false, reason: "No Gloam cash-out of the quoted amount to this API in that transaction." };
  if (received < q.price) return { ok: false, reason: "The API received less than its price in that cash-out." };
  return { ok: true, received, block: receipt.blockNumber };
}
