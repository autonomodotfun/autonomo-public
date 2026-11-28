// What a transaction's logs and input say, worked out without the network (files starting with "_" aren't routes).
// The Tx Explainer turns these into sentences. Kept apart so they can be tested on the logs of real transactions.

import { toEventSelector, toFunctionSelector } from "viem";
import { addr, signed, TRANSFER, V4_SWAP, words } from "./_lib.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
export const isBurnAddress = (a) => a === ZERO || a === DEAD;

const erc20Transfers = (logs) =>
  logs
    .filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3)
    .map((l) => ({ token: l.address.toLowerCase(), from: addr(l.topics[1]), to: addr(l.topics[2]), value: BigInt(l.data === "0x" ? 0 : l.data) }));

// ---------------------------------------------------------------- trades in Uniswap v4 pools

/**
 * The trades a transaction made in Uniswap v4 pools, read from the PoolManager's Swap events.
 *
 * A Swap event gives two signed amounts and no token names. The token on each side is the one whose transfers in
 * and out of the PoolManager add up to exactly that amount; a side with no such token is the chain's own ETH, which
 * moves without a Transfer event. Who traded is whoever ended the transaction with the tokens (a buy) or without
 * them (a sell), since the swap itself is usually sent by a router.
 *
 * Returns one row per pool: { pool, kind: "buy" | "sell" | "swap", gave, got, trader, kept }, amounts in base units,
 * an asset being a token address or "eth". `kept` lists others who ended up with part of what was bought (a pool
 * hook taking its cut).
 */
export function v4Trades(logs, poolManager, wrappedNative = null) {
  const pm = poolManager.toLowerCase();
  const pools = new Map();
  for (const l of logs) {
    if (l.address.toLowerCase() !== pm || l.topics[0] !== V4_SWAP) continue;
    const w = words(l.data);
    if (w.length < 2) continue;
    const p = pools.get(l.topics[1]) ?? { pool: l.topics[1], a0: 0n, a1: 0n };
    p.a0 += signed(w[0]);
    p.a1 += signed(w[1]);
    pools.set(l.topics[1], p);
  }
  if (!pools.size) return [];

  const moves = erc20Transfers(logs);
  const flow = new Map(); // token -> what the PoolManager took in and paid out
  const net = new Map(); // token -> address -> change over the whole transaction
  for (const m of moves) {
    const f = flow.get(m.token) ?? { in: 0n, out: 0n };
    if (m.to === pm) f.in += m.value;
    if (m.from === pm) f.out += m.value;
    flow.set(m.token, f);
    const n = net.get(m.token) ?? new Map();
    n.set(m.from, (n.get(m.from) ?? 0n) - m.value);
    n.set(m.to, (n.get(m.to) ?? 0n) + m.value);
    net.set(m.token, n);
  }

  // A negative amount is what the trader paid into the pool, a positive one what the pool paid out.
  const used = new Set();
  const tokenOf = (amount) => {
    for (const [token, f] of flow) {
      if (used.has(token)) continue;
      if ((amount < 0n && f.in === -amount) || (amount > 0n && f.out === amount)) {
        used.add(token);
        return token;
      }
    }
    return null;
  };
  const holders = (token, sign) =>
    [...(net.get(token) ?? [])]
      .filter(([a, v]) => a !== pm && !isBurnAddress(a) && (sign > 0 ? v > 0n : v < 0n))
      .map(([address, v]) => ({ address, amount: v < 0n ? -v : v }))
      .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

  const out = [];
  for (const p of pools.values()) {
    if (p.a0 === 0n || p.a1 === 0n || p.a0 > 0n === p.a1 > 0n) continue; // not a trade: nothing went one way and came back the other
    const t0 = tokenOf(p.a0);
    const t1 = tokenOf(p.a1);
    if (!t0 && !t1) continue; // neither side can be named from this transaction
    // ETH is address zero in a v4 pool, so it is always the first of the two.
    const side = (amount, token, first) => ({ asset: token ?? (first ? "eth" : "unknown"), amount: amount < 0n ? -amount : amount });
    const [s0, s1] = [side(p.a0, t0, true), side(p.a1, t1, false)];
    const gave = p.a0 < 0n ? s0 : s1;
    const got = p.a0 < 0n ? s1 : s0;
    // A pool against the wrapped coin (WETH) is a pool against ETH to the person trading.
    const isEth = (s) => s.asset === "eth" || (wrappedNative && s.asset === wrappedNative.toLowerCase());
    const kind = isEth(gave) ? "buy" : isEth(got) ? "sell" : "swap";
    const token = kind === "buy" ? got.asset : gave.asset;
    const ranked = token === "unknown" ? [] : holders(token, kind === "buy" ? 1 : -1);
    // `traderAmount` is what the trader ended up with (a buy) or parted with (a sell). It differs from the pool's
    // figure when something on the way kept a share.
    out.push({ pool: p.pool, kind, gave, got, trader: ranked[0]?.address ?? null, traderAmount: ranked[0]?.amount ?? null, kept: kind === "buy" ? ranked.slice(1, 3) : [] });
  }
  return out;
}

// ---------------------------------------------------------------- tokens made and destroyed

/**
 * Tokens created (sent from the zero address) and destroyed (sent to the zero or the dead address) in a
 * transaction, one row per token and wallet. A token that is created and destroyed in equal amounts in the same
 * transaction is left out: that is wrapping and unwrapping (WETH), not a change in supply.
 */
export function mintsAndBurns(logs, skip = new Set()) {
  const minted = new Map();
  const burned = new Map();
  const total = new Map();
  for (const m of erc20Transfers(logs)) {
    if (m.value === 0n || skip.has(m.token)) continue;
    const mint = m.from === ZERO;
    const burn = isBurnAddress(m.to);
    if (mint === burn) continue; // an ordinary transfer, or zero to zero
    const key = `${m.token}:${mint ? m.to : m.from}`;
    const rows = mint ? minted : burned;
    rows.set(key, { token: m.token, wallet: mint ? m.to : m.from, amount: (rows.get(key)?.amount ?? 0n) + m.value });
    const t = total.get(m.token) ?? { minted: 0n, burned: 0n };
    if (mint) t.minted += m.value;
    else t.burned += m.value;
    total.set(m.token, t);
  }
  const real = (r) => total.get(r.token).minted !== total.get(r.token).burned;
  return { minted: [...minted.values()].filter(real), burned: [...burned.values()].filter(real) };
}

// ---------------------------------------------------------------- permissions and control

const APPROVAL = toEventSelector("Approval(address,address,uint256)");
const OWNERSHIP = toEventSelector("OwnershipTransferred(address,address)");
const PAUSED = toEventSelector("Paused(address)");
const UNPAUSED = toEventSelector("Unpaused(address)");
const UPGRADED = toEventSelector("Upgraded(address)");
const ROLE_GRANTED = toEventSelector("RoleGranted(bytes32,address,address)");
// Wallets write "any amount" as the largest number, or close to it.
const UNLIMITED = 2n ** 255n;

/**
 * Changes to who may do what: spending permissions given, ownership moved or given up, a contract paused or
 * pointed at new code, a role handed out. Read from the standard events, so it works for any contract that emits them.
 */
export function controlEvents(logs) {
  const out = [];
  for (const l of logs) {
    const contract = l.address.toLowerCase();
    const t = l.topics;
    if (t[0] === APPROVAL && t.length === 3) {
      const amount = BigInt(l.data === "0x" ? 0 : l.data);
      out.push({ type: "approve", token: contract, owner: addr(t[1]), spender: addr(t[2]), amount, unlimited: amount >= UNLIMITED });
    } else if (t[0] === OWNERSHIP && t.length === 3) {
      const to = addr(t[2]);
      out.push({ type: "ownership", contract, from: addr(t[1]), to, renounced: isBurnAddress(to) });
    } else if (t[0] === PAUSED || t[0] === UNPAUSED) {
      out.push({ type: t[0] === PAUSED ? "paused" : "unpaused", contract });
    } else if (t[0] === UPGRADED && t.length === 2) {
      out.push({ type: "upgraded", contract, implementation: addr(t[1]) });
    } else if (t[0] === ROLE_GRANTED && t.length === 4) {
      out.push({ type: "role", contract, role: t[1], account: addr(t[2]) });
    }
  }
  // The same permission given twice in one transaction is said once, with the last amount.
  const seen = new Map();
  for (const e of out) seen.set(e.type === "approve" ? `a:${e.token}:${e.owner}:${e.spender}` : `${e.type}:${e.contract}:${e.to ?? e.implementation ?? e.account ?? ""}`, e);
  return [...seen.values()];
}

// ---------------------------------------------------------------- which function was called

// Names for calls to contracts whose code isn't published. Only functions whose name says what they do.
const COMMON = [
  "transfer(address,uint256)", "approve(address,uint256)", "transferFrom(address,address,uint256)", "setApprovalForAll(address,bool)",
  "renounceOwnership()", "transferOwnership(address)", "acceptOwnership()",
  "mint(address,uint256)", "mint(uint256)", "burn(uint256)", "burnFrom(address,uint256)",
  "pause()", "unpause()", "enableTrading()", "openTrading()", "removeLimits()",
  "setFee(uint256)", "setFees(uint256,uint256)", "setTax(uint256)", "setTaxes(uint256,uint256)", "setBuyTax(uint256)", "setSellTax(uint256)",
  "blacklist(address)", "setBlacklist(address,bool)", "blacklistAddress(address,bool)", "excludeFromFee(address)", "excludeFromFees(address,bool)",
  "setMaxTxAmount(uint256)", "setMaxWallet(uint256)", "setMaxWalletSize(uint256)", "setSwapEnabled(bool)", "setTradingEnabled(bool)",
  "upgradeTo(address)", "upgradeToAndCall(address,bytes)", "setImplementation(address)",
  "withdraw()", "withdraw(uint256)", "deposit()", "claim()", "multicall(bytes[])",
];
const BY_SELECTOR = new Map(COMMON.map((signature) => [toFunctionSelector(signature), signature]));
// A function with one of these names changes how a contract behaves or who controls it.
const CHANGES_SETTINGS = /^(?:set[A-Z_]|(?:enable|disable|open)Trading|pause|unpause|(?:un)?blacklist|whitelist|excludeFrom|includeIn|renounce|transferOwnership|acceptOwnership|upgradeTo|removeLimits|grantRole|revokeRole)/;

/**
 * The function a transaction called. `decoded` is the explorer's reading when the contract's code is published
 * ("setTaxes(uint256 buy, uint256 sell)"), otherwise the name comes from a short list of common functions.
 * Null for a plain ETH transfer or a contract creation.
 */
export function methodOf(input, decoded = null) {
  if (!input || input === "0x" || input.length < 10) return null;
  const selector = input.slice(0, 10).toLowerCase();
  const fromCode = typeof decoded === "string" && /^[A-Za-z_$][\w$]*\(/.test(decoded) ? decoded : null;
  const signature = fromCode ?? BY_SELECTOR.get(selector) ?? null;
  const name = signature ? signature.slice(0, signature.indexOf("(")) : null;
  return {
    selector,
    name,
    signature,
    source: fromCode ? "published code" : signature ? "common function name" : null,
    changesSettings: name ? CHANGES_SETTINGS.test(name) : false,
  };
}
