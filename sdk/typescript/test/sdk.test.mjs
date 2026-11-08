// Offline tests: no network, no wallet balance, no payments. Run with `npm test` after `npm run build`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Autonomo, AutonomoError, eip3009TypedData, findTransactions, memoryStore, permit2TypedData, rankApis } from "../dist/index.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // a throwaway test key
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const AUTONOMO = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const PAY_TO = "0x00000000000000000000000000000000000000aa";

const APIS = [
  { slug: "token-price", name: "Token Price", description: "show live $autonomo token price", path: "/price/autonomo", verified: true, successRate: 1, paidCalls30d: 38, price: {} },
  { slug: "new-launches", name: "New Launches", description: "Newest token launches on Robinhood Chain", path: "/launches?limit=10", verified: true, successRate: 1, paidCalls30d: 24, price: {} },
  { slug: "token-risk", name: "Token Risk", description: "Rug-risk check for a launchpad token: holders, creator, safety score", path: "/risk/<token contract address>", verified: true, successRate: 1, paidCalls30d: 10, price: {} },
  { slug: "token-lookup", name: "Token Lookup", description: "Price and market cap of any launchpad token", path: "/price/<token contract address>", verified: true, successRate: 1, paidCalls30d: 5, price: {} },
  { slug: "tx-explainer", name: "Transaction Explainer", description: "Explains a transaction in plain words", path: "/tx/<transaction hash>", verified: true, successRate: 1, paidCalls30d: 3, price: {} },
  { slug: "wallet-portfolio", name: "Wallet Portfolio", description: "What a wallet holds, with USD values", path: "/portfolio/<wallet address>", verified: true, successRate: 1, paidCalls30d: 3, price: {} },
  { slug: "page-reader", name: "Page Reader", description: "Reads a web page and returns its text", path: "/page?url=<url-encoded https:// link>", verified: true, successRate: 1, paidCalls30d: 2, price: {} },
];
const ADDR = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49";
const TX = `0x${"ab".repeat(32)}`;

test("finds the right API from the query and the kind of input", () => {
  assert.equal(rankApis(APIS, "is this token a rug risk", ADDR)[0].slug, "token-risk");
  assert.equal(rankApis(APIS, "token price", ADDR)[0].slug, "token-lookup");
  assert.equal(rankApis(APIS, "what does this wallet hold", ADDR)[0].slug, "wallet-portfolio");
  assert.equal(rankApis(APIS, "explain this transaction", TX)[0].slug, "tx-explainer");
  assert.equal(rankApis(APIS, "read this page", "https://example.com/a?b=c")[0].slug, "page-reader");
  assert.equal(rankApis(APIS, "newest launches")[0].slug, "new-launches");
  assert.equal(rankApis(APIS, "explain this transaction", ADDR).length, 0, "an address never goes to a tx-hash API");
});

test("typed data signs and recovers to the wallet", async () => {
  const account = privateKeyToAccount(KEY);
  const usdg = eip3009TypedData({ from: account.address, to: PAY_TO, value: "10000", validAfter: "0", validBefore: "9999999999", nonce: `0x${"11".repeat(32)}` }, USDG, "Global Dollar", "1");
  assert.equal(await recoverTypedDataAddress({ ...usdg, signature: await account.signTypedData(usdg) }), account.address);
  const p2 = permit2TypedData({ permitted: { token: AUTONOMO, amount: "100" }, spender: "0x402085c248EeA27D92E8b30b2C58ed07f9E20001", nonce: "5", deadline: "9999999999", witness: { to: PAY_TO, validAfter: "0" } });
  assert.equal(await recoverTypedDataAddress({ ...p2, signature: await account.signTypedData(p2) }), account.address);
});

test("finds Borro's borrow transaction and skips the typed data", () => {
  const result = {
    steps: ["send the borrow", "sign", "call credit_bill_header"],
    borrow: { to: "0x1111111111111111111111111111111111111111", data: "0xabcdef", value: "0" },
    typed_data: { message: { from: "0x2222222222222222222222222222222222222222", to: PAY_TO, value: "10000" } },
    authorization: { to: PAY_TO, value: "10000" },
  };
  assert.deepEqual(findTransactions(result), [{ to: "0x1111111111111111111111111111111111111111", data: "0xabcdef", value: "0" }]);
  assert.deepEqual(findTransactions({ authorization: {} }), []);
});

// A fake Autonomo: the gateway list, and a 402 price list for every /x/ URL.
function fakeFetch({ accepts }) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    const u = new URL(String(url));
    if (u.pathname === "/api/v1/gateways") {
      return Response.json({ data: APIS.map((a) => ({ ...a, usage: a.path, trackRecord: { successRate: 1, paidCalls: a.paidCalls30d } })) });
    }
    const required = { x402Version: 2, accepts, resource: { url: String(url) } };
    return new Response("{}", { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(required)).toString("base64") } });
  };
  f.calls = calls;
  return f;
}
const exact = (asset, amount, extra = {}) => ({ scheme: "exact", network: "eip155:4663", asset, amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra });

test("refuses before signing when the price is over the per-call cap", async () => {
  const f = fakeFetch({ accepts: [exact(USDG, "100000", { name: "Global Dollar", version: "1" })] }); // 0.10 USDG
  const a = new Autonomo({ privateKey: KEY, payWith: "usdg", fetch: f, spendStore: memoryStore() });
  await assert.rejects(a.call("newest launches"), (e) => e instanceof AutonomoError && e.code === "cannot_pay" && /per-call cap/.test(e.message));
  assert.ok(f.calls.every((c) => !c.headers["PAYMENT-SIGNATURE"]), "nothing was signed or sent");
});

test("refuses before signing when today's budget is used up", async () => {
  const store = memoryStore();
  store.add(new Date().toISOString().slice(0, 10), "usdg", 995_000n); // 0.995 of 1 USDG
  const f = fakeFetch({ accepts: [exact(USDG, "10000", { name: "Global Dollar", version: "1" })] });
  const a = new Autonomo({ privateKey: KEY, payWith: "usdg", fetch: f, spendStore: store });
  await assert.rejects(a.call("newest launches"), (e) => e.code === "cannot_pay" && /budget/.test(e.message));
});

test("private calls never fall back to a public payment", async () => {
  const f = fakeFetch({ accepts: [exact(USDG, "10000", { name: "Global Dollar", version: "1" })] });
  const a = new Autonomo({ privateKey: KEY, fetch: f, spendStore: memoryStore(), gloam: { fetchPaid: async () => assert.fail("no Gloam option, so nothing is paid") } });
  await assert.rejects(a.call("newest launches", { private: true }), (e) => e.code === "no_private_option");
  const b = new Autonomo({ privateKey: KEY, fetch: f, spendStore: memoryStore() });
  await assert.rejects(b.call("newest launches", { private: true }), (e) => e.code === "no_gloam");
});

test("pays a private call through Gloam's gloam_fetch_paid and records it as USDG", async () => {
  const gloamOffer = { scheme: "gloam-cashout", network: "eip155:4663", asset: USDG, amount: "10051", payTo: PAY_TO, extra: { quoteId: "q1" } };
  const f = fakeFetch({ accepts: [exact(USDG, "10000", { name: "Global Dollar", version: "1" }), gloamOffer] });
  const store = memoryStore();
  let args;
  const hash = `0x${"cd".repeat(32)}`;
  const a = new Autonomo({
    fetch: f, // no wallet key: a private call doesn't need one
    spendStore: store,
    gloam: { fetchPaid: async (x) => ((args = x), { status: "ok", hash, httpStatus: 200, body: JSON.stringify({ ok: true }) }) },
  });
  const { data, receipt } = await a.call("newest launches", { private: true });
  assert.deepEqual(data, { ok: true });
  assert.deepEqual(args, { url: "https://autonomo.fun/x/new-launches/launches?limit=10", maxAmount: 0.011051, prefer: "gloam-cashout" });
  assert.equal(receipt.route, "gloam");
  assert.equal(receipt.payer, "private (Gloam)");
  assert.equal(receipt.amount, "0.010051");
  assert.equal(receipt.tx, hash);
  assert.equal(store.get(new Date().toISOString().slice(0, 10)).usdg, 10051n);
});

test("a Gloam refusal pays nothing and records nothing", async () => {
  const gloamOffer = { scheme: "gloam-cashout", network: "eip155:4663", asset: USDG, amount: "10051", payTo: PAY_TO, extra: { quoteId: "q1" } };
  const f = fakeFetch({ accepts: [gloamOffer] });
  const store = memoryStore();
  const a = new Autonomo({ privateKey: KEY, fetch: f, spendStore: store, gloam: { fetchPaid: async () => ({ status: "refused", code: "over_daily", message: "over the daily limit" }) } });
  await assert.rejects(a.call("newest launches", { private: true }), (e) => e.code === "payment_refused" && /over the daily limit/.test(e.message));
  assert.equal(store.get(new Date().toISOString().slice(0, 10)).usdg, undefined);
});
