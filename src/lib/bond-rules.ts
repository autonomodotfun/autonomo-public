import { encodeFunctionData, parseAbi } from "viem";

// The provider bond's rules that don't need the chain: who shows as Bonded, what state a slash is in, and the calls a
// creator sends. Shared by server and client code, and tested offline (bond-rules.test.ts).
//
// Contract: contracts/robinhood/src/ProviderBond.sol. One bond per wallet, the wallet that gets paid.

/** How long the site hides the Bonded badge after a slash runs. The contract's SLASH_INTERVAL, in seconds. */
export const SLASH_INTERVAL_S = 30 * 24 * 3600;
/** How long a slash can still run after its dispute window. The contract's EXECUTION_GRACE, in seconds. */
export const EXECUTION_GRACE_S = 7 * 24 * 3600;

export const bondAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function requestWithdraw(uint256 amount)",
  "function cancelWithdraw()",
  "function withdraw()",
  "function bonds(address) view returns (uint128 amount, uint128 pendingWithdraw, uint64 withdrawReadyAt)",
  "function nextSlashAt(address) view returns (uint64)",
  "function openSlashOf(address) view returns (uint256)",
  "function slashes(uint256) view returns (address provider, uint64 proposedAt, uint16 refundBps, address payer, uint128 amount, uint64 executableAt, bytes32 reason)",
  "function minBond() view returns (uint128)",
  "function cooldown() view returns (uint64)",
  "function disputeWindow() view returns (uint64)",
  "function maxSlashBps() view returns (uint16)",
  "function refundBps() view returns (uint16)",
  "function slasher() view returns (address)",
  "function owner() view returns (address)",
  "function totalBonded() view returns (uint256)",
  "function token() view returns (address)",
  "event SlashProposed(uint256 indexed id, address indexed provider, address indexed payer, uint256 amount, bytes32 reason, uint256 executableAt)",
  "event SlashCancelled(uint256 indexed id, address indexed provider)",
  "event SlashExecuted(uint256 indexed id, address indexed provider, uint256 refunded, uint256 burned)",
]);
export const approveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** A wallet's bond as the contract stores it. Amounts are in the token's smallest unit, times in unix seconds. */
export type BondState = {
  amount: bigint;
  pendingWithdraw: bigint;
  withdrawReadyAt: number;
  /** Set when a slash runs: that time plus 30 days. 0 when the wallet was never slashed. */
  nextSlashAt: number;
  /** The open slash against this wallet, 0 when there is none. */
  openSlashId: bigint;
};

/**
 * Where a wallet stands. `active` is what counts: locked tokens minus any amount the creator asked to take out.
 * `meets` is the contract's own isBonded. The badge needs more: after a slash runs it stays hidden for 30 days, even
 * when what is left is still above the minimum.
 */
export function bondStanding(s: BondState, minBond: bigint, now: number) {
  const active = s.amount - s.pendingWithdraw;
  const meets = minBond > 0n && active >= minBond;
  const hiddenUntil = s.nextSlashAt > now ? s.nextSlashAt : null;
  return { active, meets, bonded: meets && hiddenUntil === null, hiddenUntil };
}

export type SlashStatus = "waiting" | "ready" | "expired" | "executed" | "cancelled";

/** The state of a slash that is still open on-chain, from its dispute window. */
export function openSlashStatus(executableAt: number, now: number): SlashStatus {
  if (now < executableAt) return "waiting";
  return now > executableAt + EXECUTION_GRACE_S ? "expired" : "ready";
}

/** How many more tokens a wallet needs to lock to reach the minimum. 0 when it already does. */
export function shortOfMinimum(s: BondState, minBond: bigint) {
  const active = s.amount - s.pendingWithdraw;
  return active >= minBond ? 0n : minBond - active;
}

export type BondCall = { to: string; data: `0x${string}`; label: string };

/** The two calls that lock `amount`: an approval for exactly that amount, then the deposit. */
export function depositCalls(token: string, bond: string, amount: bigint): BondCall[] {
  return [
    { to: token, data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [bond as `0x${string}`, amount] }), label: "Approve" },
    { to: bond, data: encodeFunctionData({ abi: bondAbi, functionName: "deposit", args: [amount] }), label: "Deposit" },
  ];
}

export function requestWithdrawCall(bond: string, amount: bigint): BondCall {
  return { to: bond, data: encodeFunctionData({ abi: bondAbi, functionName: "requestWithdraw", args: [amount] }), label: "Ask to withdraw" };
}

export function cancelWithdrawCall(bond: string): BondCall {
  return { to: bond, data: encodeFunctionData({ abi: bondAbi, functionName: "cancelWithdraw" }), label: "Stay bonded" };
}

export function withdrawCall(bond: string): BondCall {
  return { to: bond, data: encodeFunctionData({ abi: bondAbi, functionName: "withdraw" }), label: "Withdraw" };
}
