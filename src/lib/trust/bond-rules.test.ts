// Offline tests for the provider bond's rules: no network, no database.
// Run: npx tsx --test src/lib/trust/bond-rules.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";
import {
  approveAbi,
  bondAbi,
  bondStanding,
  bondTokensFor,
  depositCalls,
  EXECUTION_GRACE_S,
  lockStanding,
  openSlashStatus,
  requestWithdrawCall,
  shortOfMinimum,
  SLASH_INTERVAL_S,
  type BondState,
} from "@/lib/trust/bond-rules";

const T = 10n ** 18n;
const MIN = 460_000n * T;
const NOW = 1_800_000_000;
const none: BondState = { amount: 0n, pendingWithdraw: 0n, withdrawReadyAt: 0, nextSlashAt: 0, openSlashId: 0n };

test("a wallet at the minimum is bonded, one token under is not", () => {
  assert.equal(bondStanding({ ...none, amount: MIN }, MIN, NOW).bonded, true);
  assert.equal(bondStanding({ ...none, amount: MIN - 1n }, MIN, NOW).bonded, false);
  assert.equal(bondStanding(none, MIN, NOW).bonded, false);
});

test("an amount the creator asked to take out stops counting at once", () => {
  const s = bondStanding({ ...none, amount: MIN + 100n * T, pendingWithdraw: 101n * T, withdrawReadyAt: NOW + 14 * 86400 }, MIN, NOW);
  assert.equal(s.active, MIN - T);
  assert.equal(s.bonded, false);
});

test("a minimum of zero bonds nobody, as in the contract", () => {
  assert.equal(bondStanding({ ...none, amount: MIN }, 0n, NOW).meets, false);
});

test("after a slash the badge is hidden for 30 days, even above the minimum", () => {
  const slashedAt = NOW - 86400;
  const s = { ...none, amount: MIN * 2n, nextSlashAt: slashedAt + SLASH_INTERVAL_S };
  const during = bondStanding(s, MIN, NOW);
  assert.equal(during.meets, true);
  assert.equal(during.bonded, false);
  assert.equal(during.hiddenUntil, slashedAt + SLASH_INTERVAL_S);
  const after = bondStanding(s, MIN, slashedAt + SLASH_INTERVAL_S);
  assert.equal(after.bonded, true);
  assert.equal(after.hiddenUntil, null);
});

test("an open slash that has not run does not hide the badge", () => {
  assert.equal(bondStanding({ ...none, amount: MIN, openSlashId: 3n }, MIN, NOW).bonded, true);
});

test("an open slash waits, can run for 7 days, then is expired", () => {
  assert.equal(openSlashStatus(NOW + 1, NOW), "waiting");
  assert.equal(openSlashStatus(NOW, NOW), "ready");
  assert.equal(openSlashStatus(NOW - EXECUTION_GRACE_S, NOW), "ready");
  assert.equal(openSlashStatus(NOW - EXECUTION_GRACE_S - 1, NOW), "expired");
});

test("$100 becomes whole tokens at the weekly price, rounded to 10,000", () => {
  assert.equal(bondTokensFor(100, 0.0001693, 100_000), 590_000);
  assert.equal(bondTokensFor(100, 0.0001414, 100_000), 710_000);
  assert.equal(bondTokensFor(100, 0.00022, 100_000), 450_000);
});

test("the amount never goes under the contract's own minimum", () => {
  assert.equal(bondTokensFor(100, 0.01, 100_000), 100_000);
  assert.equal(bondTokensFor(100, 1, 0), 10_000);
});

test("a price that can't be right is refused instead of bonding everyone", () => {
  assert.throws(() => bondTokensFor(100, 0, 100_000));
  assert.throws(() => bondTokensFor(100, Number.NaN, 100_000));
});

test("a wallet that qualifies is locked at the weekly amount", () => {
  const r = lockStanding(null, 590_000, 590_000n * T);
  assert.deepEqual(r, { tokens: 590_000, locked: true, change: "insert", saveTokens: 590_000 });
  assert.equal(lockStanding(null, 590_000, 589_999n * T).change, "none");
});

test("when the price falls, a locked wallet keeps its badge at its old amount", () => {
  const r = lockStanding(590_000, 710_000, 600_000n * T);
  assert.equal(r.locked, true);
  assert.equal(r.tokens, 590_000);
  assert.equal(r.change, "none");
});

test("when the price rises, the locked amount moves down with it", () => {
  const r = lockStanding(590_000, 450_000, 600_000n * T);
  assert.equal(r.tokens, 450_000);
  assert.equal(r.change, "lower");
  assert.equal(r.saveTokens, 450_000);
});

test("falling below the locked amount drops the lock, and the weekly amount applies again", () => {
  const r = lockStanding(590_000, 710_000, 500_000n * T);
  assert.deepEqual(r, { tokens: 710_000, locked: false, change: "drop", saveTokens: 590_000 });
});

test("what is missing to reach the minimum", () => {
  assert.equal(shortOfMinimum(none, MIN), MIN);
  assert.equal(shortOfMinimum({ ...none, amount: MIN }, MIN), 0n);
  assert.equal(shortOfMinimum({ ...none, amount: MIN, pendingWithdraw: 10n * T }, MIN), 10n * T);
});

test("bonding approves exactly the amount, to the bond contract, then deposits it", () => {
  const token = "0xE83C85E1eaD16FCFe85401E2b337Fb4FB5B5cC96";
  const bond = "0x00000000000000000000000000000000000b0d01";
  const [approve, deposit] = depositCalls(token, bond, MIN);
  assert.equal(approve.to, token);
  const a = decodeFunctionData({ abi: approveAbi, data: approve.data });
  assert.equal(a.functionName, "approve");
  assert.equal(String(a.args[0]).toLowerCase(), bond);
  assert.equal(a.args[1], MIN);
  assert.equal(deposit.to, bond);
  const d = decodeFunctionData({ abi: bondAbi, data: deposit.data });
  assert.equal(d.functionName, "deposit");
  assert.deepEqual(d.args, [MIN]);
});

test("a withdrawal request carries its amount", () => {
  const call = requestWithdrawCall("0x00000000000000000000000000000000000b0d01", 5n * T);
  const d = decodeFunctionData({ abi: bondAbi, data: call.data });
  assert.equal(d.functionName, "requestWithdraw");
  assert.deepEqual(d.args, [5n * T]);
});
