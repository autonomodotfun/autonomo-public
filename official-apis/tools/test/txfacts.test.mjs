// Offline tests for what the Tx Explainer reads from a transaction's logs (api/_txfacts.js).
// fixtures/tx-logs.json holds the logs of four real Robinhood Chain transactions, saved on Nov 28, 2026.
// Run from official-apis/tools: node --test test/

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pad, toEventSelector, toHex } from "viem";
import { controlEvents, methodOf, mintsAndBurns, v4Trades } from "../api/_txfacts.js";

const real = JSON.parse(readFileSync(new URL("./fixtures/tx-logs.json", import.meta.url), "utf8"));
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const AUTONOMO = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

// Made-up logs, for the cases the real ones don't cover.
const TRANSFER = toEventSelector("Transfer(address,address,uint256)");
const SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const word = (n) => toHex(BigInt.asUintN(256, BigInt(n)), { size: 32 }).slice(2);
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const TOKEN = "0x00000000000000000000000000000000000000c3";
const WETH = "0x00000000000000000000000000000000000000d4";
const moved = (token, from, to, amount) => ({ address: token, topics: [TRANSFER, pad(from), pad(to)], data: `0x${word(amount)}` });
const swapped = (pool, a0, a1, sender = A) => ({ address: PM, topics: [SWAP, pad(pool, { size: 32 }), pad(sender)], data: `0x${word(a0)}${word(a1)}${word(1)}${word(1)}${word(0)}${word(0)}` });

// ---------------------------------------------------------------- pool trades, on real logs

test("a buy in a pool: who bought, how many tokens, and the ETH that reached the pool", () => {
  const [t, ...rest] = v4Trades(real.poolBuy.logs, PM);
  assert.equal(rest.length, 0);
  assert.equal(t.kind, "buy");
  assert.deepEqual(t.gave, { asset: "eth", amount: 182280778282084440n });
  assert.equal(t.got.asset, AUTONOMO);
  assert.equal(t.trader, real.poolBuy.from, "the buyer, not the router that sent the swap");
  assert.equal(t.traderAmount, t.got.amount);
  assert.deepEqual(t.kept, []);
  assert.ok(BigInt(real.poolBuy.value) > t.gave.amount, "less ETH reached the pool than was sent with the transaction");
});

test("the pool's hook selling the tokens it collected is a sale by the hook, not by whoever sent the transaction", () => {
  const [t] = v4Trades(real.hookSale.logs, PM);
  assert.equal(t.kind, "sell");
  assert.equal(t.trader, HOOK);
  assert.notEqual(t.trader, real.hookSale.from);
  assert.equal(t.gave.asset, AUTONOMO);
  assert.deepEqual(t.got, { asset: "eth", amount: 26451086587297549n });
});

test("a buy filled for someone else names the wallet that got the tokens, and what the hook kept", () => {
  const [t] = v4Trades(real.filledBuy.logs, PM);
  assert.equal(t.kind, "buy");
  assert.equal(t.trader, "0x65aca5aaab710ce404e51d2ee0ccbc759f667e4e");
  assert.notEqual(t.trader, real.filledBuy.from);
  assert.equal(t.kept.length, 1);
  assert.equal(t.kept[0].address, HOOK);
  assert.equal(t.traderAmount + t.kept[0].amount, t.got.amount, "what the buyer got and what the hook kept add up to what the pool paid out");
});

test("a transaction with no pool trade has none", () => {
  assert.deepEqual(v4Trades(real.creatorBurn.logs, PM), []);
  assert.deepEqual(v4Trades([], PM), []);
});

// ---------------------------------------------------------------- pool trades, made-up cases

test("a pool against WETH reads as a pool against ETH when the wrapped coin is named", () => {
  const logs = [swapped("0x01", 500n, -9000n), moved(TOKEN, A, PM, 9000n), moved(WETH, PM, B, 500n)];
  const asSwap = v4Trades(logs, PM)[0];
  assert.equal(asSwap.kind, "swap");
  const [t] = v4Trades(logs, PM, WETH);
  assert.equal(t.kind, "sell");
  assert.equal(t.trader, A);
  assert.deepEqual(t.got, { asset: WETH, amount: 500n });
});

test("a token for token trade is a swap by whoever gave the first token", () => {
  const [t] = v4Trades([swapped("0x02", -700n, 300n), moved(WETH, A, PM, 700n), moved(TOKEN, PM, A, 300n)], PM);
  assert.equal(t.kind, "swap");
  assert.equal(t.trader, A);
  assert.deepEqual([t.gave.asset, t.got.asset], [WETH, TOKEN]);
});

test("several swaps in the same pool are one trade, and two pools are two", () => {
  const one = v4Trades([swapped("0x03", -100n, 40n), swapped("0x03", -200n, 60n), moved(TOKEN, PM, A, 100n)], PM);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].gave, { asset: "eth", amount: 300n });
  assert.deepEqual(one[0].got, { asset: TOKEN, amount: 100n });
  const two = v4Trades([swapped("0x04", -100n, 40n), moved(TOKEN, PM, A, 40n), swapped("0x05", 90n, -77n), moved(WETH, B, PM, 77n)], PM);
  assert.deepEqual(two.map((t) => t.kind), ["buy", "sell"]);
});

test("a swap event whose tokens can't be found in the transaction is left alone", () => {
  assert.deepEqual(v4Trades([swapped("0x06", -100n, 40n)], PM), [], "no transfer matches either side");
  assert.deepEqual(v4Trades([swapped("0x07", -100n, 40n), moved(TOKEN, PM, A, 39n)], PM), [], "an amount that doesn't match is not that token");
  assert.deepEqual(v4Trades([swapped("0x08", 100n, 40n), moved(TOKEN, PM, A, 40n)], PM), [], "both amounts paid out is not a trade");
  assert.deepEqual(v4Trades([{ ...swapped("0x09", -100n, 40n), address: A }, moved(TOKEN, PM, A, 40n)], PM), [], "a look-alike event from another contract doesn't count");
});

// ---------------------------------------------------------------- supply

test("tokens sent to the dead address are a burn", () => {
  const { minted, burned } = mintsAndBurns(real.creatorBurn.logs);
  assert.deepEqual(minted, []);
  assert.equal(burned.length, 1);
  assert.equal(burned[0].token, AUTONOMO);
  assert.equal(burned[0].wallet, real.creatorBurn.from);
});

test("mints and burns are summed per wallet, and wrapping is neither", () => {
  const r = mintsAndBurns([moved(TOKEN, ZERO, A, 5n), moved(TOKEN, ZERO, A, 7n), moved(TOKEN, ZERO, B, 1n), moved(TOKEN, A, ZERO, 2n), moved(TOKEN, B, DEAD, 1n), moved(WETH, ZERO, A, 9n), moved(WETH, A, ZERO, 9n), moved(TOKEN, A, B, 3n)]);
  assert.deepEqual(r.minted, [{ token: TOKEN, wallet: A, amount: 12n }, { token: TOKEN, wallet: B, amount: 1n }]);
  assert.deepEqual(r.burned, [{ token: TOKEN, wallet: A, amount: 2n }, { token: TOKEN, wallet: B, amount: 1n }]);
  assert.equal(r.minted.some((m) => m.token === WETH), false, "made and destroyed in equal amounts: wrapping, not new supply");
});

test("a launched token's own supply can be left out", () => {
  assert.deepEqual(mintsAndBurns([moved(TOKEN, ZERO, A, 5n)], new Set([TOKEN])), { minted: [], burned: [] });
  assert.equal(mintsAndBurns(real.poolBuy.logs).minted.length, 0, "a buy creates no tokens");
});

// ---------------------------------------------------------------- permissions and control

const event = (signature, contract, topics, data = "0x") => ({ address: contract, topics: [toEventSelector(signature), ...topics], data });

test("spending permissions: an amount, any amount, and taken back", () => {
  const max = (1n << 256n) - 1n;
  const [some, any, none] = controlEvents([
    event("Approval(address,address,uint256)", TOKEN, [pad(A), pad(B)], `0x${word(1000n)}`),
    event("Approval(address,address,uint256)", WETH, [pad(A), pad(B)], `0x${word(max)}`),
    event("Approval(address,address,uint256)", TOKEN, [pad(B), pad(A)], `0x${word(0n)}`),
  ]);
  assert.deepEqual(some, { type: "approve", token: TOKEN, owner: A, spender: B, amount: 1000n, unlimited: false });
  assert.equal(any.unlimited, true);
  assert.equal(none.amount, 0n);
});

test("the same permission given twice is said once, with the last amount, and an NFT approval is not a token one", () => {
  const out = controlEvents([
    event("Approval(address,address,uint256)", TOKEN, [pad(A), pad(B)], `0x${word(5n)}`),
    event("Approval(address,address,uint256)", TOKEN, [pad(A), pad(B)], `0x${word(3n)}`),
    event("Approval(address,address,uint256)", WETH, [pad(A), pad(B), pad("0x07", { size: 32 })]),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 3n);
});

test("ownership moved and given up, a pause, new code and a role", () => {
  const out = controlEvents([
    event("OwnershipTransferred(address,address)", TOKEN, [pad(A), pad(B)]),
    event("OwnershipTransferred(address,address)", WETH, [pad(B), pad(ZERO)]),
    event("Paused(address)", TOKEN, [], `0x${word(1n)}`),
    event("Upgraded(address)", TOKEN, [pad(B)]),
    event("RoleGranted(bytes32,address,address)", TOKEN, [pad("0x01", { size: 32 }), pad(A), pad(B)]),
  ]);
  assert.deepEqual(out.map((e) => e.type), ["ownership", "ownership", "paused", "upgraded", "role"]);
  assert.equal(out[0].renounced, false);
  assert.equal(out[1].renounced, true);
  assert.equal(out[3].implementation, B);
  assert.deepEqual(controlEvents(real.poolBuy.logs), [], "a plain buy changes no permission");
});

// ---------------------------------------------------------------- the function called

test("the function called: from published code, from a common name, or unknown", () => {
  const code = methodOf("0x12345678aabb", "setTaxes(uint256 buy, uint256 sell)");
  assert.deepEqual(code, { selector: "0x12345678", name: "setTaxes", signature: "setTaxes(uint256 buy, uint256 sell)", source: "published code", changesSettings: true });
  const common = methodOf("0x715018a6");
  assert.equal(common.name, "renounceOwnership");
  assert.equal(common.source, "common function name");
  assert.equal(common.changesSettings, true);
  assert.deepEqual(methodOf(real.poolBuy.selector + "00"), { selector: real.poolBuy.selector, name: null, signature: null, source: null, changesSettings: false });
  assert.equal(methodOf("0x"), null, "plain ETH sent");
  assert.equal(methodOf(null), null);
});

test("only functions that change how a contract behaves count as settings", () => {
  const settings = (name) => methodOf("0x11111111", `${name}(uint256 a)`).changesSettings;
  for (const name of ["setFee", "enableTrading", "pause", "blacklist", "excludeFromFees", "transferOwnership", "upgradeToAndCall", "grantRole"]) assert.equal(settings(name), true, name);
  for (const name of ["sweepPoolWithFloor", "settle", "swap", "buy", "transfer", "claim", "updatePrice", "openPosition", "mint", "setup"]) assert.equal(settings(name), false, name);
  assert.equal(methodOf("0xa9059cbb", "not a function name").name, "transfer", "an unreadable reading from the explorer falls back to the common name");
});
