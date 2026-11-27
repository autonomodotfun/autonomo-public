import assert from "node:assert/strict";
import { test } from "node:test";
import { blacklistedProblem, floatProblem, frozenProblem, MIRROR_FLOAT_CAP_USDG, mirrorTotalProblem } from "./burn-guard";

const USDG = 1_000_000n;

test("the mirror runs when our records are level with or ahead of the pot", () => {
  assert.equal(mirrorTotalProblem(0n, 0n), null);
  assert.equal(mirrorTotalProblem(50n * USDG, 50n * USDG), null);
  assert.equal(mirrorTotalProblem(51n * USDG, 50n * USDG), null);
});

test("the mirror stops when the pot's total is above our records, by any amount", () => {
  const stolen = mirrorTotalProblem(50n * USDG, 10n ** 30n);
  assert.match(stolen ?? "", /^Mirror burn stopped/);
  assert.match(stolen ?? "", /Nothing was sent/);
  assert.match(stolen ?? "", /above our records \(50\)/);
  // One atomic unit is enough: rows removed from the records look the same as a total the app never gave.
  assert.notEqual(mirrorTotalProblem(50n * USDG - 1n, 50n * USDG), null);
});

test("the float may sit at its cap, and anything above it is named with the excess", () => {
  assert.equal(MIRROR_FLOAT_CAP_USDG, 100n * USDG);
  assert.equal(floatProblem(0n), null);
  assert.equal(floatProblem(2_052_995n), null);
  assert.equal(floatProblem(100n * USDG), null);
  const over = floatProblem(250n * USDG + 500_000n);
  assert.match(over ?? "", /holds 250\.5 USDG/);
  assert.match(over ?? "", /Withdraw 150\.5 USDG to the owner/);
});

test("a freeze or a blacklist is reported with the address, and silence otherwise", () => {
  assert.equal(frozenProblem(false, "0xabc"), null);
  assert.equal(blacklistedProblem(false, "0xdef"), null);
  assert.match(frozenProblem(true, "0xabc") ?? "", /frozen the BuybackBurner \(0xabc\)/);
  assert.match(blacklistedProblem(true, "0xdef") ?? "", /blacklisted the Base reserve Safe \(0xdef\)/);
});
