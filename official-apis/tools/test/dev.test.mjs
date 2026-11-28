// Offline tests for the Dev Wallet Tracker's own sums (api/dev.js): rows are given as the explorer returns them.
// Run from official-apis/tools: node --test test/

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAINS } from "../api/_lib.js";
import { classify, firstFunding, incomeBySender, outcomeOf } from "../api/dev.js";

const DEV = "0x00000000000000000000000000000000000000d1";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const ESCROW = "0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e";
const CURVE = "0x00000000000000000000000000000000000000c7";
const ETH = 10n ** 18n;
const at = (day) => String(Date.UTC(2026, 10, day) / 1000);
const eth = (n) => ((BigInt(Math.round(n * 1e6)) * ETH) / 1_000_000n).toString();

// ---------------------------------------------------------------- who funded a wallet

test("the first funding is the earliest ETH in, whether sent directly or from inside a contract", () => {
  const normal = [
    { from: DEV, to: A, value: eth(1), timeStamp: at(5), hash: "0xout" },
    { from: A, to: DEV, value: eth(0.2), timeStamp: at(3), hash: "0xlater" },
    { from: B, to: DEV, value: eth(9), timeStamp: at(1), hash: "0xfailed", isError: "1" },
    { from: B, to: DEV, value: "0", timeStamp: at(1), hash: "0xempty" },
  ];
  const internal = [{ from: B, to: DEV, value: eth(0.05), timeStamp: at(2), transactionHash: "0xbridge" }];
  assert.equal(firstFunding(DEV, normal, internal).transactionHash, "0xbridge");
  assert.equal(firstFunding(DEV, normal, []).hash, "0xlater", "a failed transfer and an empty one fund nothing");
  assert.equal(firstFunding(DEV, [], []), null);
});

test("fees paid out by the escrow are never taken for the wallet's funding", () => {
  const internal = [{ from: ESCROW, to: DEV, value: eth(1), timeStamp: at(1), transactionHash: "0xfees" }, { from: A, to: DEV, value: eth(0.1), timeStamp: at(2), transactionHash: "0xreal" }];
  assert.equal(firstFunding(DEV, [], internal, ESCROW).transactionHash, "0xreal");
});

// ---------------------------------------------------------------- where the ETH came from

test("ETH received is summed by sender, largest first, with the first and last time", () => {
  const normal = [
    { from: A, to: DEV, value: eth(0.5), timeStamp: at(4), hash: "0xa2" },
    { from: A, to: DEV, value: eth(0.25), timeStamp: at(2), hash: "0xa1" },
    { from: DEV, to: A, value: eth(3), timeStamp: at(3), hash: "0xout" },
    { from: B, to: DEV, value: eth(7), timeStamp: at(3), hash: "0xfailed", isError: "1" },
  ];
  const internal = [{ from: ESCROW, to: DEV, value: eth(2), timeStamp: at(6), transactionHash: "0xclaim" }];
  const [first, second, ...rest] = incomeBySender(DEV, normal, internal);
  assert.equal(rest.length, 0, "ETH sent out and failed transfers aren't income");
  assert.equal(first.address, ESCROW);
  assert.equal(first.eth, 2);
  assert.equal(first.lastTx, "0xclaim");
  assert.deepEqual({ address: second.address, eth: second.eth, transactions: second.transactions, lastTx: second.lastTx }, { address: A, eth: 0.75, transactions: 2, lastTx: "0xa2" });
  assert.ok(second.firstTime < second.lastTime);
});

// ---------------------------------------------------------------- how an earlier launch ended

const SUPPLY = 1_000_000n * ETH;
const move = (from, to, tokens, hash) => ({ from, to, value: (BigInt(tokens) * ETH).toString(), hash, timeStamp: at(2) });
const NOW = Date.UTC(2026, 10, 20);
const launch = { token: "0x00000000000000000000000000000000000000f0", tx: "0xlaunch", curve: CURVE };

test("an earlier launch: what the creator bought, sold, burned, sent and still holds", () => {
  const moves = [move(CURVE, DEV, 100_000, "0xbuy"), move(DEV, CURVE, 40_000, "0xsell"), move(DEV, "0x000000000000000000000000000000000000dead", 10_000, "0xburn"), move(DEV, A, 20_000, "0xsend")];
  const o = outcomeOf({ launch, meta: { name: "Old", symbol: "OLD" }, supply: SUPPLY, balance: 30_000n * ETH, moves, lastTransfer: { timeStamp: at(10) }, holders: "42", dev: DEV, paidIn: new Set(["0xsell"]), chain: CHAINS.robinhood, now: NOW });
  assert.deepEqual(o, {
    token: launch.token, name: "Old", symbol: "OLD", launchTx: "0xlaunch",
    creatorHoldsPercent: 3, creatorBoughtPercent: 10, creatorSoldPercent: 4, creatorBurnedPercent: 1, creatorSentPercent: 2,
    holders: 42, lastTransferAt: new Date(Date.UTC(2026, 10, 10)).toISOString(), daysSinceLastTransfer: 10, historyRead: true,
  });
});

test("tokens put in the pool without ETH coming back are not a sale", () => {
  const o = outcomeOf({ launch, meta: null, supply: SUPPLY, balance: 0n, moves: [move(DEV, CURVE, 50_000, "0xadd")], lastTransfer: null, holders: null, dev: DEV, paidIn: new Set(), chain: CHAINS.robinhood, now: NOW });
  assert.equal(o.creatorSoldPercent, 0);
  assert.equal(o.lastTransferAt, null);
  assert.equal(o.daysSinceLastTransfer, null);
  assert.equal(o.holders, null);
});

test("when the explorer has none of the creator's moves, only what they hold is stated", () => {
  for (const moves of [[], null]) {
    const o = outcomeOf({ launch: { ...launch, launchpad: "Clanker", curve: undefined }, meta: null, supply: SUPPLY, balance: 5_000n * ETH, moves, lastTransfer: null, holders: undefined, dev: DEV, paidIn: new Set(), chain: CHAINS.base, now: NOW });
    assert.equal(o.historyRead, false);
    assert.equal(o.creatorHoldsPercent, 0.5);
    assert.equal(o.creatorSoldPercent, null, "not read is not the same as nothing sold");
    assert.equal(o.launchpad, "Clanker");
  }
  assert.equal(outcomeOf({ launch, meta: null, supply: null, balance: null, moves: null, lastTransfer: null, holders: null, dev: DEV, paidIn: new Set(), chain: CHAINS.robinhood, now: NOW }).creatorHoldsPercent, null);
});

test("classify, as before", () => {
  assert.equal(classify(true, CURVE, CURVE), "bought");
  assert.equal(classify(false, CURVE, CURVE), "sold");
  assert.equal(classify(false, CHAINS.robinhood.poolManager, null), "sold");
  assert.equal(classify(false, "0x0000000000000000000000000000000000000000", CURVE), "burned");
  assert.equal(classify(false, A, CURVE), "sent");
  assert.equal(classify(true, A, CURVE), "received");
});
