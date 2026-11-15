// Offline tests for automatic $AUTONOMO pricing: no network, no database.
// Run: npx tsx --test src/lib/gateway-rules.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { autonomoAmountFor, autonomoUsdHint, planReprice, usdPriceFromAmount } from "@/lib/gateway-rules";

// $0.00016 a token: the example in the plan, where $0.01 comes to 50 $AUTONOMO.
const TOKEN_USD = 0.00016;

test("the $AUTONOMO amount is the dollar price, 20% lower, in whole tokens", () => {
  assert.equal(autonomoAmountFor(0.01, TOKEN_USD), "50");
  assert.equal(autonomoAmountFor(0.05, TOKEN_USD), "250");
  assert.equal(autonomoAmountFor(0.1, TOKEN_USD), "500");
  assert.equal(autonomoAmountFor(0.001, TOKEN_USD), "5", "very cheap APIs still work");
  assert.equal(autonomoAmountFor(0.000001, TOKEN_USD), "1", "never less than one token");
  assert.equal(autonomoUsdHint(50, TOKEN_USD), "about $0.008");
});

test("it follows the token price both ways", () => {
  assert.equal(autonomoAmountFor(0.01, TOKEN_USD * 2), "25", "token doubles: half the tokens");
  assert.equal(autonomoAmountFor(0.01, TOKEN_USD / 2), "100", "token halves: twice the tokens");
});

test("bad prices are refused rather than priced at zero or infinity", () => {
  assert.throws(() => autonomoAmountFor(0, TOKEN_USD));
  assert.throws(() => autonomoAmountFor(0.01, 0));
  assert.throws(() => autonomoAmountFor(Number.NaN, TOKEN_USD));
});

test("an API with only a $AUTONOMO amount keeps today's amount when it moves over", () => {
  const usd = usdPriceFromAmount(100, TOKEN_USD);
  assert.equal(usd, "0.02");
  assert.equal(autonomoAmountFor(Number(usd), TOKEN_USD), "100");
});

test("the daily repricing changes only what moved, and leaves USDG-only APIs alone", () => {
  const rows = [
    { id: 1, priceUsd: "0.01", autonomoAmount: "100" }, // an official API at the old fixed 100
    { id: 2, priceUsd: "0.01", autonomoAmount: "50" }, // already right
    { id: 3, priceUsd: "0.05", autonomoAmount: null }, // USDG only
    { id: 4, priceUsd: "0", autonomoAmount: "100" }, // $AUTONOMO only, from before there was always a dollar price
  ];
  assert.deepEqual(planReprice(rows, TOKEN_USD), [
    { id: 1, priceUsd: "0.01", autonomoAmount: "50", was: "100" },
    { id: 4, priceUsd: "0.02", autonomoAmount: "100", was: "100" },
  ]);
  // The next day, at a new price, the $AUTONOMO-only API follows its dollar price like the rest.
  const nextDay = planReprice([{ id: 4, priceUsd: "0.02", autonomoAmount: "100" }], TOKEN_USD * 2);
  assert.deepEqual(nextDay, [{ id: 4, priceUsd: "0.02", autonomoAmount: "50", was: "100" }]);
});
