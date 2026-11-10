// Offline tests: a fake Autonomo and a fake RPC on localhost, no wallet balance, no payments. Run with `npm test`
// after `npm run build`.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Autonomo, memoryStore } from "autonomo-sdk";
import { AutonomoToolkit } from "../dist/index.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // a throwaway test key
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PAY_TO = "0x00000000000000000000000000000000000000aa";
const ADDR = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49";
const TX = `0x${"ef".repeat(32)}`;

const APIS = [
  ["new-launches", "New Launches", "Newest token launches on Robinhood Chain", "/launches?limit=10"],
  ["token-risk", "Token Risk", "Rug-risk check for a launchpad token: holders, creator, safety score", "/risk/<token contract address>"],
  ["wallet-portfolio", "Wallet Portfolio", "What a wallet holds, with USD values", "/portfolio/<wallet address>"],
];

// A fake RPC that says the wallet holds plenty of every token, so the SDK goes on to sign. Nothing real is paid.
let rpc;
let RPC_URL;
before(async () => {
  rpc = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const one = (r) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_call" ? `0x${(10n ** 30n).toString(16).padStart(64, "0")}` : "0x1253" });
      const parsed = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)));
    });
  });
  await new Promise((r) => rpc.listen(0, "127.0.0.1", r));
  RPC_URL = `http://127.0.0.1:${rpc.address().port}`;
});
after(() => rpc.close());

// A fake autonomo.fun: the gateway list, a 402 price list, and an answer once a payment is sent.
function fakeFetch({ price = "10000", answer = { score: 12 }, status = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const headers = init.headers ?? {};
    calls.push({ url: String(url), paid: Boolean(headers["PAYMENT-SIGNATURE"]) });
    const u = new URL(String(url));
    if (u.pathname === "/api/v1/gateways") {
      return Response.json({
        data: APIS.map(([slug, name, description, usage]) => ({ slug, name, description, usage, price: { usdg: 0.01 }, verified: true, trackRecord: { successRate: 1, paidCalls: 5 } })),
      });
    }
    if (headers["PAYMENT-SIGNATURE"]) {
      const settled = Buffer.from(JSON.stringify({ transaction: TX })).toString("base64");
      return Response.json(answer, { status, headers: status === 200 ? { "payment-response": settled } : {} });
    }
    const accepts = [{ scheme: "exact", network: "eip155:4663", asset: USDG, amount: price, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } }];
    const required = { x402Version: 2, accepts, resource: { url: String(url) } };
    return new Response("{}", { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(required)).toString("base64") } });
  };
  f.paid = () => calls.filter((c) => c.paid).length;
  return f;
}

const client = (f, opts = {}) => new Autonomo({ privateKey: KEY, payWith: "usdg", fetch: f, rpcUrl: RPC_URL, spendStore: memoryStore(), ...opts });
const byName = (kit) => Object.fromEntries(kit.getTools().map((t) => [t.name, t]));
const run = async (t, args) => JSON.parse(await t.invoke(args));

test("without a wallet, only the free tools", () => {
  const f = fakeFetch();
  assert.deepEqual(Object.keys(byName(new AutonomoToolkit({ fetch: f }))).sort(), ["autonomo_find_apis", "autonomo_get_price"]);
  assert.ok(byName(new AutonomoToolkit({ client: client(f) })).autonomo_call_api);
  assert.equal(byName(new AutonomoToolkit({ client: client(f), maxCalls: 0 })).autonomo_call_api, undefined);
});

test("finding APIs is free and filters by the input", async () => {
  const f = fakeFetch();
  const { autonomo_find_apis: find } = byName(new AutonomoToolkit({ client: client(f) }));
  const out = await run(find, { query: "is this token safe", input: ADDR });
  assert.equal(out.apis[0].slug, "token-risk");
  assert.equal(out.apis[0].path, "/risk/<token contract address>");
  assert.equal((await run(find, {})).apis[0].slug, "new-launches");
  assert.equal(f.paid(), 0);
});

test("a price check pays nothing", async () => {
  const f = fakeFetch();
  const out = await run(byName(new AutonomoToolkit({ client: client(f) })).autonomo_get_price, { slug: "token-risk", input: ADDR });
  assert.equal(out.url, `https://autonomo.fun/x/token-risk/risk/${ADDR}`);
  assert.deepEqual(out.offers, [{ scheme: "exact", token: "USDG", amount: "0.01", private: false }]);
  assert.equal(f.paid(), 0);
});

test("a call pays and returns the answer and a receipt", async () => {
  const f = fakeFetch();
  const kit = new AutonomoToolkit({ client: client(f) });
  const out = await run(byName(kit).autonomo_call_api, { slug: "token-risk", path: `/risk/${ADDR}` });
  assert.deepEqual(out.data, { score: 12 });
  assert.deepEqual([out.receipt.route, out.receipt.amount, out.receipt.token, out.receipt.tx], ["usdg", "0.01", "USDG", TX]);
  assert.ok(out.receipt.explorer.endsWith(TX));
  assert.equal(kit.paidCalls, 1);
  assert.equal(f.paid(), 1);
});

test("over the per-call cap: the model is told why, and nothing is signed", async () => {
  const f = fakeFetch({ price: "100000" }); // 0.10 USDG, above the default 0.05 cap
  const kit = new AutonomoToolkit({ client: client(f) });
  const out = await run(byName(kit).autonomo_call_api, { query: "newest launches" });
  assert.equal(out.error, "cannot_pay");
  assert.match(out.message, /per-call cap/);
  assert.equal(f.paid(), 0);
  assert.equal(kit.paidCalls, 0);
});

test("stops after maxCalls, even when the tools are fetched again", async () => {
  const f = fakeFetch();
  const kit = new AutonomoToolkit({ client: client(f), maxCalls: 2 });
  const call = byName(kit).autonomo_call_api;
  await run(call, { query: "newest launches" });
  await run(call, { query: "newest launches" });
  assert.equal((await run(call, { query: "newest launches" })).error, "over_limit");
  assert.equal((await run(byName(kit).autonomo_call_api, { query: "newest launches" })).error, "over_limit");
  assert.equal(f.paid(), 2);
});

test("calls at the same time can't pass maxCalls together", async () => {
  const f = fakeFetch();
  const kit = new AutonomoToolkit({ client: client(f), maxCalls: 2 });
  const call = byName(kit).autonomo_call_api;
  const outs = await Promise.all([1, 2, 3, 4].map(() => run(call, { query: "newest launches" })));
  assert.equal(outs.filter((o) => o.receipt).length, 2);
  assert.equal(outs.filter((o) => o.error === "over_limit").length, 2);
  assert.equal(f.paid(), 2);
});

test("a failed API isn't counted", async () => {
  const f = fakeFetch({ status: 500, answer: { error: "upstream down" } });
  const kit = new AutonomoToolkit({ client: client(f), maxCalls: 1 });
  const out = await run(byName(kit).autonomo_call_api, { query: "newest launches" });
  assert.equal(out.error, "payment_refused");
  assert.match(out.message, /aren't charged/);
  assert.equal(kit.paidCalls, 0);
});

test("long answers are cut", async () => {
  const f = fakeFetch({ answer: { text: "x".repeat(5000) } });
  const out = await run(byName(new AutonomoToolkit({ client: client(f), maxOutputChars: 1000 })).autonomo_call_api, { query: "newest launches" });
  assert.equal(typeof out.data, "string");
  assert.match(out.data, /\[cut:/);
  assert.ok(out.data.length < 1200);
  assert.equal(out.receipt.tx, TX);
});

test("private without Gloam never pays publicly", async () => {
  const f = fakeFetch();
  const out = await run(byName(new AutonomoToolkit({ client: client(f) })).autonomo_call_api, { query: "newest launches", private: true });
  assert.equal(out.error, "no_gloam");
  assert.equal(f.paid(), 0);
});

test("options or a client, not both", () => {
  const f = fakeFetch();
  assert.throws(() => new AutonomoToolkit({ client: client(f), privateKey: KEY }), /not both/);
  assert.throws(() => new AutonomoToolkit({ maxCalls: -1 }), /maxCalls/);
  assert.ok(new AutonomoToolkit({ privateKey: KEY, fetch: f, spendStore: memoryStore() }).canPay);
});

test("a model can use the tools", async () => {
  // A scripted model asks for the tools by name, as a real one would, and gets their answers back.
  const f = fakeFetch();
  const tools = byName(new AutonomoToolkit({ client: client(f) }));
  const script = [
    new AIMessage({ content: "", tool_calls: [{ id: "1", name: "autonomo_find_apis", args: { query: "token risk", input: ADDR } }] }),
    new AIMessage({ content: "", tool_calls: [{ id: "2", name: "autonomo_call_api", args: { slug: "token-risk", path: `/risk/${ADDR}` } }] }),
    new AIMessage("Risk score 12."),
  ];
  const results = [];
  for (const ai of script) {
    for (const tc of ai.tool_calls ?? []) {
      const msg = await tools[tc.name].invoke({ ...tc, type: "tool_call" });
      assert.ok(msg instanceof ToolMessage);
      results.push(JSON.parse(msg.content));
    }
  }
  assert.equal(results[0].apis[0].slug, "token-risk");
  assert.equal(results[1].receipt.tx, TX);
  assert.equal(f.paid(), 1);
});
