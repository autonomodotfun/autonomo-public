// Offline tests: the real server over stdio, against a stand-in for Autonomo and for both chains' RPCs on localhost.
// No network, no real wallet, no payments. Run with `npm test`.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "index.mjs");
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // a throwaway test key
const WALLET = privateKeyToAccount(KEY).address;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const AUTONOMO = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";

const usdgOffer = (amount = "10000", payTo = PAY_TO) => ({ scheme: "exact", network: "eip155:4663", asset: USDG, amount, payTo, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } });
const usdcOffer = (amount = "10000", payTo = PAY_TO) => ({ scheme: "exact", network: "eip155:8453", asset: USDC, amount, payTo, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } });
const autonomoOffer = (amount = "36000000000000000000") => ({ scheme: "exact", network: "eip155:4663", asset: AUTONOMO, amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { assetTransferMethod: "permit2" } });

/**
 * Starts the stand-in and the server, runs `fn`, and stops both. `balances` are in each token's smallest unit, keyed
 * by token address; `offers` may be a function of the request number, to change the price list between two requests.
 */
async function withServer({ offers, balances = {}, env = {} }, fn) {
  const paid = [];
  const rpcMethods = [];
  let priced = 0;
  const site = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url.startsWith("/rpc/")) {
      const onBase = req.url === "/rpc/base";
      const one = (b) => {
        rpcMethods.push(b.method);
        if (b.method === "eth_chainId") return { jsonrpc: "2.0", id: b.id, result: onBase ? "0x2105" : "0x1237" };
        if (b.method === "eth_getBalance") return { jsonrpc: "2.0", id: b.id, result: "0x0" };
        const held = b.method === "eth_call" ? (balances[b.params?.[0]?.to?.toLowerCase()] ?? 0n) : 0n;
        return { jsonrpc: "2.0", id: b.id, result: `0x${held.toString(16).padStart(64, "0")}` };
      };
      const parsed = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)));
    }
    const signature = req.headers["payment-signature"];
    if (signature) {
      paid.push(JSON.parse(Buffer.from(signature, "base64").toString()));
      res.setHeader("payment-response", Buffer.from(JSON.stringify({ success: true, transaction: `0x${"cd".repeat(32)}` })).toString("base64"));
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ ok: true }));
    }
    const accepts = typeof offers === "function" ? offers(priced++) : offers;
    const required = { x402Version: 2, accepts, resource: { url: `http://localhost${req.url}`, description: "test", mimeType: "application/json" } };
    res.statusCode = 402;
    res.setHeader("payment-required", Buffer.from(JSON.stringify(required)).toString("base64"));
    res.end("{}");
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const home = mkdtempSync(join(tmpdir(), "autonomo-mcp-test-")); // the spend file lands here, not in the real home
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, HOME: home, USERPROFILE: home, AUTONOMO_BASE_URL: origin, AUTONOMO_RPC_URL: `${origin}/rpc/robinhood`, AUTONOMO_BASE_RPC_URL: `${origin}/rpc/base`, AUTONOMO_WALLET_KEY: KEY, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  const tool = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content.map((c) => c.text).join("");
    return { isError: Boolean(r.isError), text, json: r.isError ? null : JSON.parse(text) };
  };
  try {
    await fn({ tool, paid, rpcMethods, client });
  } finally {
    await client.close();
    await new Promise((r) => site.close(r));
  }
}
const call = (pay_with) => ({ slug: "new-launches", path: "/launches", ...(pay_with ? { pay_with } : {}) });

async function signer(envelope, name, version, chainId) {
  const a = envelope.payload.authorization;
  return recoverTypedDataAddress({
    domain: { name, version, chainId, verifyingContract: envelope.accepted.asset },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    signature: envelope.payload.signature,
  });
}

test("the tools are listed, and a price check labels USDC on Base", async () => {
  await withServer({ offers: [usdgOffer(), autonomoOffer(), usdcOffer()] }, async ({ tool, client, paid }) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["call_api", "find_apis", "get_price", "wallet_status"]);
    assert.deepEqual(tools.find((t) => t.name === "call_api").inputSchema.properties.pay_with.enum, ["auto", "usdg", "autonomo", "usdc"]);
    const price = await tool("get_price", call());
    assert.deepEqual(price.json.offers.map((o) => `${o.amount} ${o.token}`), ["0.01 USDG", "36 AUTONOMO", "0.01 USDC on Base"]);
    assert.match(price.json.defaultPayment, /^auto/);
    assert.equal(paid.length, 0);
  });
});

test("pays with USDC on Base when asked: signed for Base, with a Basescan link", async () => {
  await withServer({ offers: [usdgOffer(), usdcOffer()], balances: { [USDC.toLowerCase()]: 50_000n } }, async ({ tool, paid }) => {
    const r = await tool("call_api", call("usdc"));
    assert.ok(!r.isError, r.text);
    assert.equal(paid.length, 1);
    assert.equal(paid[0].accepted.network, "eip155:8453");
    assert.equal(await signer(paid[0], "USD Coin", "2", 8453), WALLET);
    assert.deepEqual(r.json.paid, { amount: "0.01", token: "USDC on Base", chain: "Base", from: WALLET, to: PAY_TO });
    assert.match(r.json.tx, /^https:\/\/basescan\.org\/tx\/0x/);
    assert.equal(r.json.spentToday, "0.01 of 5 dollars (USDG and USDC)");
    assert.deepEqual(r.json.data, { ok: true });
  });
});

test("left to itself it pays USDG first, and USDC on Base when that is all the wallet holds", async () => {
  await withServer({ offers: [usdgOffer(), autonomoOffer(), usdcOffer()], balances: { [USDG.toLowerCase()]: 10_000n, [USDC.toLowerCase()]: 10_000n } }, async ({ tool, paid }) => {
    const r = await tool("call_api", call());
    assert.ok(!r.isError, r.text);
    assert.equal(r.json.paid.token, "USDG");
    assert.equal(r.json.paid.chain, "Robinhood Chain");
    assert.equal(await signer(paid[0], "Global Dollar", "1", 4663), WALLET);
  });
  await withServer({ offers: [usdgOffer(), autonomoOffer(), usdcOffer()], balances: { [USDC.toLowerCase()]: 10_000n } }, async ({ tool, paid }) => {
    const r = await tool("call_api", call());
    assert.ok(!r.isError, r.text);
    assert.equal(r.json.paid.token, "USDC on Base");
    assert.equal(paid[0].accepted.network, "eip155:8453");
  });
});

test("an empty wallet signs nothing and says what each token is short of", async () => {
  await withServer({ offers: [usdgOffer(), autonomoOffer(), usdcOffer()] }, async ({ tool, paid }) => {
    const auto = await tool("call_api", call());
    assert.ok(auto.isError);
    assert.match(auto.text, /No token could pay.*USDG: Not enough USDG.*AUTONOMO: Not enough AUTONOMO.*USDC on Base: Not enough USDC on Base/);
    const one = await tool("call_api", call("usdc"));
    assert.match(one.text, /^Not enough USDC on Base: the wallet 0x[0-9a-fA-F]{40} has 0, the call costs 0\.01 USDC on Base\.$/);
    assert.equal(paid.length, 0);
  });
});

test("USDG and USDC on Base share the daily dollar budget and the per-call cap", async () => {
  const env = { AUTONOMO_DAILY_USDG: "0.015" };
  await withServer({ offers: [usdgOffer(), usdcOffer()], balances: { [USDG.toLowerCase()]: 10n ** 9n, [USDC.toLowerCase()]: 10n ** 9n }, env }, async ({ tool, paid }) => {
    assert.ok(!(await tool("call_api", call("usdg"))).isError);
    const second = await tool("call_api", call("usdc"));
    assert.ok(second.isError);
    assert.match(second.text, /Daily budget reached: 0\.01 of 0\.015 dollars \(USDG and USDC\)/);
    assert.equal(paid.length, 1);
  });
  await withServer({ offers: [usdcOffer("600000")], balances: { [USDC.toLowerCase()]: 10n ** 9n } }, async ({ tool, paid }) => {
    const over = await tool("call_api", call("usdc"));
    assert.match(over.text, /above this server's cap of 0\.5 USDG\/USDC per call/);
    assert.equal(paid.length, 0);
  });
  // The cap is a setting.
  await withServer({ offers: [usdcOffer("600000")], balances: { [USDC.toLowerCase()]: 10n ** 9n }, env: { AUTONOMO_MAX_USDG_PER_CALL: "1" } }, async ({ tool, paid }) => {
    assert.ok(!(await tool("call_api", call("usdc"))).isError);
    assert.equal(paid[0].accepted.amount, "600000");
  });
});

test("nothing is signed when the price or the payee changes after the check", async () => {
  for (const second of [usdgOffer("20000"), usdgOffer("10000", OTHER)]) {
    const offers = (n) => [n === 0 ? usdgOffer() : second];
    await withServer({ offers, balances: { [USDG.toLowerCase()]: 10n ** 9n } }, async ({ tool, paid }) => {
      const r = await tool("call_api", call("usdg"));
      assert.ok(r.isError);
      assert.match(r.text, /price or payee changed/);
      assert.equal(paid.length, 0);
    });
  }
});

test("wallet_status reads both chains, shows the limits and signs nothing", async () => {
  const balances = { [USDG.toLowerCase()]: 1_250_000n, [AUTONOMO]: 4_500n * 10n ** 18n, [USDC.toLowerCase()]: 500_000n };
  await withServer({ offers: [usdgOffer()], balances }, async ({ tool, paid, rpcMethods }) => {
    const r = await tool("wallet_status");
    assert.ok(!r.isError, r.text);
    assert.equal(r.json.wallet, WALLET);
    assert.deepEqual(r.json.robinhoodChain, { usdg: "1.25", autonomo: "4500", eth: "0" });
    assert.deepEqual(r.json.base, { usdc: "0.5" });
    assert.equal(r.json.spentToday.dollars, "0 of 5 (USDG 0, USDC on Base 0)");
    assert.deepEqual(r.json.perCallCap, { dollars: "0.5", autonomo: "5000" });
    assert.equal(paid.length, 0);
    assert.ok(rpcMethods.every((m) => ["eth_call", "eth_getBalance", "eth_chainId"].includes(m)), "only reads");
  });
  await withServer({ offers: [usdgOffer()], env: { AUTONOMO_WALLET_KEY: "" } }, async ({ tool }) => {
    const none = await tool("wallet_status");
    assert.ok(none.isError);
    assert.match(none.text, /No wallet set/);
  });
});
