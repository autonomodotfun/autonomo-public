// Offline tests: a fake Autonomo, a fake RPC on localhost and a fake agent runtime. No wallet balance, no payments,
// no model key. Run with `npm test` after `npm run build`.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { Autonomo, memoryStore } from "autonomo-sdk";
import autonomoPlugin, { createAutonomoPlugin } from "../dist/index.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // a throwaway test key
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PAY_TO = "0x00000000000000000000000000000000000000aa";
const ADDR = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49";
const OTHER = "0x1111111111111111111111111111111111111111";
const TX = `0x${"ef".repeat(32)}`;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

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

// A fake autonomo.fun: the API list, a 402 price list, and an answer once a payment is sent.
function fakeFetch({ price = "10000", answer = { score: 12 }, status = 200, down = false, base = false } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    if (down) throw new TypeError("fetch failed");
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
    if (base) accepts.push({ scheme: "exact", network: "eip155:8453", asset: BASE_USDC, amount: price, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } });
    const required = { x402Version: 2, accepts, resource: { url: String(url) } };
    return new Response("{}", { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(required)).toString("base64") } });
  };
  f.paid = () => calls.filter((c) => c.paid).length;
  f.urls = () => calls.map((c) => c.url);
  return f;
}

// The part of an agent runtime the plugin uses: its settings, its small model and its logger.
function fakeRuntime(settings = {}, model) {
  const prompts = [];
  const logs = [];
  return {
    agentId: "00000000-0000-0000-0000-000000000001",
    getSetting: (k) => settings[k] ?? null,
    useModel: async (type, { prompt }) => {
      prompts.push({ type, prompt });
      if (!model) throw new Error("no model");
      return model(prompt);
    },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    prompts,
    logs,
  };
}

const plugin = (f, opts = {}) => createAutonomoPlugin({ fetch: f, rpcUrl: RPC_URL, spendStore: memoryStore(), ...opts });
const action = (p, name) => p.actions.find((a) => a.name === name);
const msg = (text) => ({ content: { text, source: "test" } });
const WALLET = { AUTONOMO_WALLET_KEY: KEY, AUTONOMO_PAY_WITH: "usdg" };

/** Runs an action the way elizaOS 2.x does: the planner filled in the parameters. */
const planned = (p, name, runtime, parameters, said = "") => {
  const replies = [];
  return action(p, name)
    .handler(runtime, msg(said), undefined, { parameters }, async (c) => (replies.push(c), []))
    .then((result) => ({ result, replies }));
};
/** Runs an action the way elizaOS 1.x does: only the message, and a callback for the answer. */
const fromChat = (p, name, runtime, said) => {
  const replies = [];
  return action(p, name)
    .handler(runtime, msg(said), undefined, {}, async (c) => (replies.push(c), []))
    .then((result) => ({ result, replies }));
};

test("the plugin has three actions, each with a description and parameters", () => {
  assert.equal(autonomoPlugin.name, "autonomo");
  assert.deepEqual(autonomoPlugin.actions.map((a) => a.name), ["AUTONOMO_FIND_APIS", "AUTONOMO_GET_PRICE", "AUTONOMO_CALL_API"]);
  for (const a of autonomoPlugin.actions) {
    assert.ok(a.description.length > 40);
    assert.ok(a.examples.length > 0);
    for (const prm of a.parameters) assert.deepEqual([typeof prm.name, typeof prm.description, prm.required, typeof prm.schema.type], ["string", "string", false, "string"]);
  }
  // Without Gloam set up, the agent isn't offered a private payment.
  assert.equal(action(autonomoPlugin, "AUTONOMO_CALL_API").parameters.some((p) => p.name === "private"), false);
});

test("without a wallet, the paying action isn't offered and refuses", async () => {
  const f = fakeFetch();
  const p = plugin(f);
  const rt = fakeRuntime();
  assert.equal(await action(p, "AUTONOMO_FIND_APIS").validate(rt, msg("")), true);
  assert.equal(await action(p, "AUTONOMO_GET_PRICE").validate(rt, msg("")), true);
  assert.equal(await action(p, "AUTONOMO_CALL_API").validate(rt, msg("")), false);
  const { result } = await planned(p, "AUTONOMO_CALL_API", rt, { slug: "token-risk", input: ADDR });
  assert.equal(result.success, false);
  assert.equal(result.data.error, "no_wallet");
  assert.equal(f.paid(), 0);
  assert.equal(await action(p, "AUTONOMO_CALL_API").validate(fakeRuntime(WALLET), msg("")), true);
});

test("finding APIs is free and filters by the input", async () => {
  const f = fakeFetch();
  const p = plugin(f);
  const { result, replies } = await planned(p, "AUTONOMO_FIND_APIS", fakeRuntime(WALLET), { query: "is this token safe", input: ADDR });
  assert.equal(result.success, true);
  assert.equal(result.data.apis[0].slug, "token-risk");
  assert.match(result.text, /Token Risk \(token-risk\), verified: .*Path \/risk\/<token contract address>\. 0\.01 USDG per call\./);
  // The planner sends null or an empty string for what it left out.
  const all = await planned(p, "AUTONOMO_FIND_APIS", fakeRuntime(WALLET), { query: null, input: "" });
  assert.equal(all.result.data.apis.length, 3);
  assert.equal(replies.length, 0);
  assert.equal(f.paid(), 0);
});

test("a price check pays nothing, and shows the ways the agent can pay, USDC on Base included", async () => {
  const f = fakeFetch({ base: true });
  const { result } = await planned(plugin(f), "AUTONOMO_GET_PRICE", fakeRuntime(WALLET), { slug: "token-risk", input: ADDR });
  assert.equal(result.data.url, `https://autonomo.fun/x/token-risk/risk/${ADDR}`);
  assert.deepEqual(result.data.offers, [
    { scheme: "exact", token: "USDG", amount: "0.01", private: false },
    { scheme: "exact", token: "USDC on Base", amount: "0.01", private: false },
  ]);
  assert.match(result.text, /One call to Token Risk costs 0\.01 USDG, or 0\.01 USDC on Base\./);
  assert.ok(!result.text.includes("0x8335"));
  assert.ok(!result.text.includes("Gloam"));
  assert.equal(f.paid(), 0);
});

test("2.x: a call pays, and the result carries the answer and the receipt", async () => {
  const f = fakeFetch();
  const rt = fakeRuntime(WALLET);
  const { result, replies } = await planned(plugin(f), "AUTONOMO_CALL_API", rt, { slug: "token-risk", path: `/risk/${ADDR}` });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.answer, { score: 12 });
  assert.deepEqual([result.data.receipt.route, result.data.receipt.amount, result.data.receipt.token, result.data.receipt.tx], ["usdg", "0.01", "USDG", TX]);
  assert.match(result.text, /Token Risk answered:\n\{"score":12\}\n\nPaid 0\.01 USDG for Token Risk: .*efef\. Spent today: /);
  assert.equal(f.paid(), 1);
  // The planner writes the reply, so the action sends nothing itself and doesn't use the model.
  assert.equal(replies.length, 0);
  assert.equal(rt.prompts.length, 0);
  // The result is plain data, as the runtime stores it.
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("1.x: the action reads the message, pays and answers through the callback", async () => {
  const f = fakeFetch();
  const rt = fakeRuntime(WALLET, (prompt) =>
    prompt.startsWith("Read the user's message") ? `Sure: {"query": "token risk", "input": "${ADDR}"}` : "The token scores 12 out of 100 for risk.",
  );
  const { result, replies } = await fromChat(plugin(f), "AUTONOMO_CALL_API", rt, `Is this token safe? ${ADDR}`);
  assert.equal(result.success, true);
  assert.equal(f.paid(), 1);
  assert.ok(f.urls().includes(`https://autonomo.fun/x/token-risk/risk/${ADDR}`));
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].actions, ["AUTONOMO_CALL_API"]);
  assert.equal(replies[0].source, "test");
  // The model words the answer; what was paid comes from the receipt.
  assert.match(replies[0].text, /^The token scores 12 out of 100 for risk\.\n\nPaid 0\.01 USDG for Token Risk: .*efef\./);
  assert.equal(replies[0].text, result.text);
  assert.deepEqual(rt.prompts.map((p) => p.type), ["TEXT_SMALL", "TEXT_SMALL"]);
  assert.match(rt.prompts[1].prompt, /\{"score":12\}/);
});

test("1.x: an address the model made up is never paid for", async () => {
  const f = fakeFetch();
  const rt = fakeRuntime(WALLET, (prompt) => (prompt.startsWith("Read the user's message") ? `{"query": "token risk", "input": "${OTHER}"}` : "ok"));
  await fromChat(plugin(f), "AUTONOMO_CALL_API", rt, `Is this token safe? ${ADDR}`);
  assert.ok(f.urls().includes(`https://autonomo.fun/x/token-risk/risk/${ADDR}`));
  assert.ok(!f.urls().some((u) => u.includes(OTHER)));
});

test("1.x: it still works when the model fails", async () => {
  const f = fakeFetch();
  const rt = fakeRuntime(WALLET); // useModel throws
  const { result, replies } = await fromChat(plugin(f), "AUTONOMO_CALL_API", rt, `Is this token safe? ${ADDR}`);
  assert.equal(result.success, true);
  assert.ok(f.urls().includes(`https://autonomo.fun/x/token-risk/risk/${ADDR}`));
  assert.match(replies[0].text, /^Token Risk answered:\n\{"score":12\}\n\nPaid 0\.01 USDG/);
  const found = await fromChat(plugin(fakeFetch()), "AUTONOMO_FIND_APIS", rt, "what can you tell me about wallet holdings?");
  assert.equal(found.result.data.apis[0].slug, "wallet-portfolio");
  assert.match(found.replies[0].text, /^Autonomo APIs for /);
});

test("over the per-call cap: the agent is told why, and nothing is signed", async () => {
  const f = fakeFetch({ price: "600000" }); // 0.60 USDG, above the default 0.5 cap
  const { result } = await planned(plugin(f), "AUTONOMO_CALL_API", fakeRuntime(WALLET), { query: "newest launches" });
  assert.equal(result.success, false);
  assert.equal(result.data.error, "cannot_pay");
  assert.match(result.text, /per-call cap/);
  assert.equal(result.error, result.text);
  assert.equal(f.paid(), 0);
});

test("limits come from the agent's settings", async () => {
  const tight = fakeFetch();
  const refused = await planned(plugin(tight), "AUTONOMO_CALL_API", fakeRuntime({ ...WALLET, AUTONOMO_MAX_USDG_PER_CALL: "0.005" }), { query: "newest launches" });
  assert.equal(refused.result.data.error, "cannot_pay");
  assert.equal(tight.paid(), 0);

  const f = fakeFetch();
  const p = plugin(f);
  const rt = fakeRuntime({ ...WALLET, AUTONOMO_DAILY_USDG: "0.02" });
  assert.equal((await planned(p, "AUTONOMO_CALL_API", rt, { query: "newest launches" })).result.success, true);
  assert.equal((await planned(p, "AUTONOMO_CALL_API", rt, { query: "newest launches" })).result.success, true);
  const third = await planned(p, "AUTONOMO_CALL_API", rt, { query: "newest launches" });
  assert.equal(third.result.success, false);
  assert.match(third.result.text, /today's dollar budget/);
  assert.equal(f.paid(), 2);
});

test("a setting that can't be read turns paying off, and the key is never shown", async () => {
  for (const bad of [{ AUTONOMO_DAILY_USDG: "one" }, { AUTONOMO_MAX_USDG_PER_CALL: "$0.05" }, { AUTONOMO_PAY_WITH: "eth" }, { AUTONOMO_BORRO_ACCOUNT: "0x12" }]) {
    const f = fakeFetch();
    const p = plugin(f);
    const rt = fakeRuntime({ ...WALLET, ...bad });
    await p.init({}, rt);
    assert.equal(await action(p, "AUTONOMO_CALL_API").validate(rt, msg("")), false);
    const { result } = await planned(p, "AUTONOMO_CALL_API", rt, { query: "newest launches" });
    assert.equal(result.data.error, "bad_settings");
    assert.match(result.text, new RegExp(Object.keys(bad)[0]));
    assert.equal(f.paid(), 0);
    assert.match(rt.logs.join("\n"), /Paying is off/);
    // The free actions keep working.
    assert.equal((await planned(p, "AUTONOMO_FIND_APIS", rt, {})).result.success, true);
  }
  const f = fakeFetch();
  const p = plugin(f);
  const rt = fakeRuntime({ AUTONOMO_WALLET_KEY: `${KEY}zz` });
  await p.init({}, rt);
  const { result } = await planned(p, "AUTONOMO_CALL_API", rt, { query: "newest launches" });
  assert.equal(result.data.error, "bad_settings");
  assert.ok(!JSON.stringify([result, rt.logs]).includes(KEY.slice(2, 20)));
  assert.equal(f.paid(), 0);
});

test("init says which wallet pays, without the key", async () => {
  const rt = fakeRuntime(WALLET);
  await plugin(fakeFetch()).init({}, rt);
  assert.match(rt.logs.join("\n"), /Ready to pay from 0x[0-9a-fA-F]{40}\./);
  assert.ok(!rt.logs.join("\n").includes(KEY.slice(2)));
  const none = fakeRuntime();
  await plugin(fakeFetch()).init({}, none);
  assert.match(none.logs.join("\n"), /No AUTONOMO_WALLET_KEY set/);
});

test("a failed API isn't charged, and a network failure is a result, not a crash", async () => {
  const f = fakeFetch({ status: 500, answer: { error: "upstream down" } });
  const failed = await planned(plugin(f), "AUTONOMO_CALL_API", fakeRuntime(WALLET), { query: "newest launches" });
  assert.equal(failed.result.success, false);
  assert.equal(failed.result.data.error, "payment_refused");
  assert.match(failed.result.text, /aren't charged/);

  const down = await planned(plugin(fakeFetch({ down: true })), "AUTONOMO_FIND_APIS", fakeRuntime(WALLET), {});
  assert.equal(down.result.success, false);
  assert.equal(down.result.data.error, "failed");
  const chat = await fromChat(plugin(fakeFetch({ down: true })), "AUTONOMO_FIND_APIS", fakeRuntime(WALLET), "what APIs are there?");
  assert.match(chat.replies[0].text, /The request to Autonomo failed/);
});

test("long answers are cut", async () => {
  const f = fakeFetch({ answer: { text: "x".repeat(5000) } });
  const { result } = await planned(plugin(f), "AUTONOMO_CALL_API", fakeRuntime({ ...WALLET, AUTONOMO_MAX_OUTPUT_CHARS: "1000" }), { query: "newest launches" });
  assert.equal(typeof result.data.answer, "string");
  assert.match(result.data.answer, /\[cut:/);
  assert.ok(result.text.length < 1400);
  assert.equal(result.data.receipt.tx, TX);
});

test("each agent has its own wallet and limits", async () => {
  const f = fakeFetch();
  const p = plugin(f);
  const a = fakeRuntime(WALLET);
  const b = fakeRuntime();
  assert.equal(await action(p, "AUTONOMO_CALL_API").validate(a, msg("")), true);
  assert.equal(await action(p, "AUTONOMO_CALL_API").validate(b, msg("")), false);
});

test("a client made in code is used as it is, and Gloam adds the private option", async () => {
  const f = fakeFetch();
  const client = new Autonomo({ privateKey: KEY, payWith: "usdg", fetch: f, rpcUrl: RPC_URL, spendStore: memoryStore() });
  const p = createAutonomoPlugin({ client });
  const { result } = await planned(p, "AUTONOMO_CALL_API", fakeRuntime(), { slug: "token-risk", input: ADDR });
  assert.equal(result.data.receipt.tx, TX);
  // No Gloam on this client: a stray private flag from the planner is ignored, never a reason to pay another way.
  assert.equal(action(p, "AUTONOMO_CALL_API").parameters.some((x) => x.name === "private"), false);

  const gloamed = createAutonomoPlugin({ fetch: f, rpcUrl: RPC_URL, spendStore: memoryStore(), gloam: { fetchPaid: async () => ({ status: "error", message: "not set up" }) } });
  assert.equal(action(gloamed, "AUTONOMO_CALL_API").parameters.some((x) => x.name === "private"), true);
  const before = f.paid();
  const priv = await planned(gloamed, "AUTONOMO_CALL_API", fakeRuntime(WALLET), { query: "newest launches", private: true });
  assert.equal(priv.result.success, false);
  assert.equal(f.paid(), before); // a private call that can't go through Gloam is never paid publicly
});
