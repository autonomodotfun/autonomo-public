import { formatUnits } from "viem";

// Guards on the daily burn run. They exist because two addresses and one key sit under every burn:
// - the keeper key states the Base total that caps what the MirrorBurnPot may send, and that total can never go down
//   on-chain. So the app states the total from its own records only, and stops if the contract's is ever higher.
// - the pot's float is all a stolen keeper key could send into a buyback, so it's kept small.
// - every splitter sends its 5% to one shared address per chain (the BuybackBurner, the reserve Safe on Base) before
//   the creator's share. If the token's issuer froze that address, every creator's flush would fail.
// Each returns a sentence for a person to act on, or null when there is nothing to do.

/** The most USDG the mirror burn pot should hold. A float this size leaves a stolen keeper key nothing to gain. */
export const MIRROR_FLOAT_CAP_USDG = 100_000_000n; // 100 USDG

const usd = (atomic: bigint) => formatUnits(atomic, 6);

/**
 * The pot's on-chain total must never be above what our records count. It is only written by the keeper, with the
 * total the app gave it, so a higher one means the keeper key wrote it without the app, or call records were removed.
 * Sending anyway would release money on a total we can't account for.
 */
export function mirrorTotalProblem(counted: bigint, onChain: bigint): string | null {
  if (onChain <= counted) return null;
  return (
    `Mirror burn stopped: the pot's on-chain total of Base payments (${usd(onChain)}) is above our records (${usd(counted)}). ` +
    "Nothing was sent. Check the keeper key and the call records. If the key was used without the app: replace the keeper, " +
    "withdraw the float to the owner and deploy a new pot, since the on-chain total can't be lowered."
  );
}

/** The float is above its cap: the excess should go back to the owner. */
export function floatProblem(held: bigint, cap: bigint = MIRROR_FLOAT_CAP_USDG): string | null {
  if (held <= cap) return null;
  return `The mirror burn pot holds ${usd(held)} USDG, above its ${usd(cap)} USDG cap. Withdraw ${usd(held - cap)} USDG to the owner.`;
}

/** The shared address every Robinhood Chain splitter pays its 5% to is frozen by USDG's issuer. */
export function frozenProblem(frozen: boolean, buybackBurner: string): string | null {
  if (!frozen) return null;
  return (
    `USDG has frozen the BuybackBurner (${buybackBurner}). Every creator's USDG flush on Robinhood Chain fails until ` +
    "the freeze is lifted. Raise it with the issuer."
  );
}

/** The shared address every Base splitter pays its 5% to is blacklisted by USDC's issuer. */
export function blacklistedProblem(blacklisted: boolean, reserve: string): string | null {
  if (!blacklisted) return null;
  return (
    `USDC has blacklisted the Base reserve Safe (${reserve}). Every creator's flush on Base fails until it is lifted. ` +
    "Raise it with the issuer."
  );
}
