// Offline tests for reading an endpoint's 402 before it's added to a listing: fetch is stubbed, no database.
// Run: npx tsx --conditions=react-server --test src/lib/attach-endpoint.test.ts

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DIRECT, readEndpoint } from "@/lib/attach-endpoint";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const PAYEE = "0xaf48a5ab32ef96ee7a72ed6ed4534be1bc928c73";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let called: string[] = [];
function answer(status: number, { header, body }: { header?: unknown; body?: unknown } = {}) {
  called = [];
  globalThis.fetch = (async (url: URL | string) => {
    called.push(String(url));
    const headers = new Headers({ "content-type": "application/json" });
    if (header) headers.set("payment-required", Buffer.from(JSON.stringify(header)).toString("base64"));
    return new Response(body === undefined ? "{}" : JSON.stringify(body), { status, headers });
  }) as typeof fetch;
}

const v2 = {
  x402Version: 2,
  resource: { url: "https://qhooks.com/api/x402/v1/qproof/scan?chain=4663&address=0x01", description: "Fresh QProof scan, run on request." },
  accepts: [
    { scheme: "exact", network: "eip155:4663", asset: USDG, payTo: PAYEE, amount: "250000", extra: { name: "Global Dollar" } },
    { scheme: "exact", network: "eip155:8453", asset: USDC_BASE, payTo: PAYEE, amount: "250000", extra: { name: "USD Coin" } },
  ],
  extensions: { bazaar: { info: { input: { type: "http", method: "GET", queryParams: { chain: "4663", address: "0x01" } } } } },
};

test("a v2 402 gives the endpoint, its price, both chains and the payee", async () => {
  answer(402, { header: v2 });
  const r = await readEndpoint("https://qhooks.com/api/x402/v1/qproof/scan?chain=4663&address=0x01");
  assert.ok(r.ok);
  assert.equal(r.url, "https://qhooks.com/api/x402/v1/qproof/scan", "the example query values aren't stored");
  assert.equal(r.method, "GET");
  assert.equal(r.priceUsd, "0.25", "USDG prices as a dollar stablecoin");
  assert.deepEqual(r.networks, ["eip155:4663", "base"]);
  assert.equal(r.payTo, PAYEE);
  assert.equal(r.description, "Fresh QProof scan, run on request.");
  assert.equal(r.row.facilitator, DIRECT);
  assert.equal(r.row.host, "qhooks.com");
  assert.deepEqual((r.row.bazaarInfo as { input: { queryParams: object } }).input.queryParams, { chain: "4663", address: "0x01" });
});

test("a v1 402 with the requirements in the body works too", async () => {
  answer(402, { body: { x402Version: 1, accepts: [{ scheme: "exact", network: "base", asset: USDC_BASE, payTo: PAYEE, maxAmountRequired: "20000" }] } });
  const r = await readEndpoint("https://api.example.org.uk/v1/report");
  assert.ok(r.ok);
  assert.equal(r.priceUsd, "0.02");
  assert.deepEqual(r.networks, ["base"]);
});

test("a 402 can't file itself under another host", async () => {
  answer(402, { header: { ...v2, resource: { url: "https://someone-else.com/api" } } });
  const r = await readEndpoint("https://qhooks.com/api/x402/v1/qproof?chain=4663&address=0x01");
  assert.ok(r.ok);
  assert.equal(r.url, "https://qhooks.com/api/x402/v1/qproof");
});

test("anything but a 402 with a way to pay is refused", async () => {
  answer(200);
  let r = await readEndpoint("https://qhooks.com/api/x402/v1/qproof");
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /answered 200/);

  answer(402, { body: { error: "payment_required", accepts: [] } });
  r = await readEndpoint("https://qhooks.com/api/x402/v1/qproof");
  assert.equal(r.ok, false);
});

test("only public https addresses are fetched", async () => {
  answer(402, { header: v2 });
  for (const url of ["http://qhooks.com/api", "https://localhost/api", "https://127.0.0.1/api", "https://192.168.1.4/api", "https://10.0.0.1/api", "not a url"]) {
    const r = await readEndpoint(url);
    assert.equal(r.ok, false, url);
  }
  assert.equal(called.length, 0, "none of them were called");
});
