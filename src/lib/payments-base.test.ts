// Offline tests for USDC on Base: Coinbase's facilitator is stood in for by a fake fetch, and nothing is paid.
// Run: npx tsx --conditions=react-server --test src/lib/payments-base.test.ts

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mock, test } from "node:test";
import { encodeFunctionResult, parseAbi } from "viem";
import { generatePrivateKey } from "viem/accounts";

// A throwaway Ed25519 key in Coinbase's format (seed then public key, base64), so the JWT signing really runs.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url");
const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");

const SAFE = "0x92a99FBD386F87277b6009BFF4C56728Ec5f7354";
const SPLITTER = "0xc66181e50aF128ffEe6048E8d4097bDC84776313";
process.env.FACILITATOR_PRIVATE_KEY = generatePrivateKey();
process.env.CDP_API_KEY_ID = "test-key";
process.env.CDP_API_KEY_SECRET = Buffer.concat([seed, pub]).toString("base64");
delete process.env.BASE_RPC_URL;
delete process.env.ROBINHOOD_RPC_URL;

// What each chain holds at an address: a Safe's signers and threshold, or nothing (null).
type SafeAt = { owners: string[]; threshold: bigint } | null;
const SIGNERS = ["0x8E451DF31669Fa84246529de1E2C601632C1aEa2", "0xeFaA9bc262cd45A0dc57c844B5cF853d932D5802"];
const chains: Record<"base" | "robinhood", Map<string, SafeAt>> = { base: new Map(), robinhood: new Map() };
const SAFE_ABI = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
const rpcCalls = { base: 0, robinhood: 0 };
// Code on Robinhood Chain at addresses that aren't Safes (an EIP-7702 delegation, some other contract).
const codes = new Map<string, string>();

function rpcAnswer(chain: "base" | "robinhood", body: { id: number; method: string; params: [{ to: string; data: string }] }) {
  rpcCalls[chain]++;
  if (body.method === "eth_getCode") {
    const at = String(body.params[0]).toLowerCase();
    // A Safe has code; otherwise whatever the test set, or none (a plain wallet).
    const code = codes.get(at) ?? (chains[chain].get(at) ? "0x6080604052" : "0x");
    return { jsonrpc: "2.0", id: body.id, result: code };
  }
  if (body.method !== "eth_call") return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "not in this test" } };
  const { to, data } = body.params[0];
  const safe = chains[chain].get(to.toLowerCase()) ?? null;
  if (!safe) return { jsonrpc: "2.0", id: body.id, result: "0x" };
  const result = data.startsWith("0xa0e67e2b")
    ? encodeFunctionResult({ abi: SAFE_ABI, functionName: "getOwners", result: safe.owners as `0x${string}`[] })
    : encodeFunctionResult({ abi: SAFE_ABI, functionName: "getThreshold", result: safe.threshold });
  return { jsonrpc: "2.0", id: body.id, result };
}

// What the fake Coinbase answers, and what it was asked.
let answer: "base" | "no-base" | "down" = "down";
const asked: { url: string; auth: string | null }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const chain = url.startsWith("https://mainnet.base.org") ? "base" : url.startsWith("https://rpc.mainnet.chain.robinhood.com") ? "robinhood" : null;
  if (chain) {
    const body = JSON.parse(String(init?.body));
    return Response.json(Array.isArray(body) ? body.map((b) => rpcAnswer(chain, b)) : rpcAnswer(chain, body));
  }
  if (!url.startsWith("https://api.cdp.coinbase.com/")) return realFetch(input, init);
  asked.push({ url, auth: new Headers(init?.headers).get("authorization") });
  if (answer === "down") return new Response("unavailable", { status: 503 });
  const kinds = answer === "base" ? [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }] : [{ x402Version: 2, scheme: "exact", network: "eip155:137" }];
  return Response.json({ kinds, extensions: [], signers: {} });
}) as typeof fetch;

mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-16T12:00:00Z") });

const payments = await import("@/lib/payments");
const { acceptsFor, baseReady, basePayeeOk, baseSafeOk, offers, railForAsset, x402Server, USDC_BASE } = payments;
const PRICE = { priceUsd: "0.01", acceptUsdg: true, autonomoAmount: "59" };

test("Base is off for an API that isn't given a Base payee, even with everything set", () => {
  assert.equal(payments.platform.base, true);
  assert.deepEqual(
    offers(PRICE).map((o) => o.kind),
    ["usdg", "autonomo"],
  );
  assert.deepEqual(
    offers(PRICE, { basePayTo: "not an address" }).map((o) => o.kind),
    ["usdg", "autonomo"],
  );
});

test("USDC on Base costs the dollar price and pays the Safe, not the splitter", () => {
  const list = offers(PRICE, { basePayTo: SAFE.toLowerCase() });
  assert.deepEqual(
    list.map((o) => o.kind),
    ["usdg", "autonomo", "usdc_base"],
  );
  const [usdg, , base] = acceptsFor(SPLITTER, list);
  assert.equal(usdg.payTo, SPLITTER);
  assert.equal(base.payTo, SAFE, "checksummed Safe address");
  assert.equal(base.network, "eip155:8453");
  assert.deepEqual(base.price, { amount: "10000", asset: USDC_BASE.address, extra: { name: "USD Coin", version: "2" } });
});

test("a payment is told apart by its network as well as its token", () => {
  assert.equal(railForAsset(USDC_BASE.address, "eip155:8453"), "usdc_base");
  assert.equal(railForAsset(USDC_BASE.address.toLowerCase(), "eip155:8453"), "usdc_base");
  assert.equal(railForAsset("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "eip155:8453"), null, "USDG's address on Base is not USDG");
  assert.equal(railForAsset("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "eip155:4663"), "usdg");
  assert.equal(railForAsset(USDC_BASE.address, "eip155:4663"), null);
});

test("Base is not offered while Coinbase is down, and isn't asked again for a minute", async () => {
  answer = "down";
  assert.equal(await baseReady(), false);
  const before = asked.length;
  assert.equal(await baseReady(), false);
  assert.equal(asked.length, before, "no second request within the minute");
  assert.ok(asked[0].auth?.startsWith("Bearer "), "the request is signed");
});

test("Base is not offered when Coinbase doesn't settle on Base", async () => {
  answer = "no-base";
  mock.timers.tick(61_000);
  assert.equal(await baseReady(), false);
});

test("once Coinbase settles on Base it is offered, and a later outage doesn't take it away", async () => {
  answer = "base";
  mock.timers.tick(6 * 3_600_000 + 1);
  assert.equal(await baseReady(), true);
  answer = "down";
  mock.timers.tick(6 * 3_600_000 + 1);
  assert.equal(await baseReady(), true, "the last answer is kept");
});

// Each case uses its own address, since a result is kept for a while.
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const both = (a: string, onBase: SafeAt, onRobinhood: SafeAt) => {
  chains.base.set(a, onBase);
  chains.robinhood.set(a, onRobinhood);
};
const twoOfTwo = { owners: SIGNERS, threshold: 2n };

test("the same Safe on both chains can be paid on Base", async () => {
  both(addr(1), twoOfTwo, { owners: [...SIGNERS].reverse(), threshold: 2n });
  assert.equal(await baseSafeOk(addr(1)), true, "signer order doesn't matter");
});

test("a creator's plain wallet can be paid on Base, an EIP-7702 one too", async () => {
  both(addr(20), null, null);
  assert.equal(await basePayeeOk(addr(20)), true, "no code");
  codes.set(addr(21), "0xef0100" + "ab".repeat(20));
  assert.equal(await basePayeeOk(addr(21)), true, "7702 delegation");
});

test("a creator's Safe can be paid on Base only if it's the same Safe there", async () => {
  both(addr(22), twoOfTwo, twoOfTwo);
  assert.equal(await basePayeeOk(addr(22)), true);
  both(addr(23), null, twoOfTwo);
  assert.equal(await basePayeeOk(addr(23)), false, "no Safe on Base");
});

test("any other contract wallet is not paid on Base", async () => {
  codes.set(addr(24), "0x6080604052");
  assert.equal(await basePayeeOk(addr(24)), false);
});

test("an address with no Safe on Base is never paid there", async () => {
  both(addr(2), null, twoOfTwo);
  assert.equal(await baseSafeOk(addr(2)), false);
});

test("a plain wallet is not treated as a Safe", async () => {
  both(addr(3), null, null);
  assert.equal(await baseSafeOk(addr(3)), false);
});

test("a Safe whose signers or threshold differ on Base is not paid there", async () => {
  both(addr(4), { owners: [SIGNERS[0], addr(99)], threshold: 2n }, twoOfTwo);
  assert.equal(await baseSafeOk(addr(4)), false, "different signer");
  both(addr(5), { owners: SIGNERS, threshold: 1n }, twoOfTwo);
  assert.equal(await baseSafeOk(addr(5)), false, "1 of 2 on Base");
});

test("a passed check is kept for an hour, then read again", async () => {
  both(addr(6), twoOfTwo, twoOfTwo);
  assert.equal(await baseSafeOk(addr(6)), true);
  const before = rpcCalls.base;
  chains.base.set(addr(6), { owners: SIGNERS, threshold: 1n });
  assert.equal(await baseSafeOk(addr(6)), true, "kept");
  assert.equal(rpcCalls.base, before, "not read again");
  mock.timers.tick(3_600_001);
  assert.equal(await baseSafeOk(addr(6)), false, "a signer change on one chain is caught after the hour");
});

test("the 402 a payer receives lists all three options, each with its own payee", async () => {
  answer = "base";
  const { withX402 } = await import("@x402/next");
  const { NextRequest, NextResponse } = await import("next/server");
  const handler = withX402(
    async () => NextResponse.json({ ok: true }),
    { accepts: acceptsFor(SPLITTER, offers(PRICE, { basePayTo: SAFE })), description: "Test API", mimeType: "application/json" },
    x402Server()!,
  );
  const res = await handler(new NextRequest("https://autonomo.fun/x/test/a"));
  assert.equal(res.status, 402);
  const required = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"));
  const summary = required.accepts.map((a: { network: string; asset: string; payTo: string; amount: string }) => [a.network, a.asset, a.payTo, a.amount]);
  assert.deepEqual(summary, [
    ["eip155:4663", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", SPLITTER, "10000"],
    ["eip155:4663", "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96", SPLITTER, "59000000000000000000"],
    ["eip155:8453", USDC_BASE.address, SAFE, "10000"],
  ]);
});
