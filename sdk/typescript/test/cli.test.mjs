// Offline tests for the CLI: no network, no wallet balance, no payments. Run with `npm test` after `npm run build`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, run } from "../dist/cli.js";
import { memoryStore } from "../dist/index.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // a throwaway test key
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PAY_TO = "0x00000000000000000000000000000000000000aa";
const ADDR = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49";
const TX = `0x${"ab".repeat(32)}`;

const APIS = [
  { slug: "token-price", name: "Token Price", description: "show live $autonomo token price", usage: "/price/autonomo" },
  { slug: "new-launches", name: "New Launches", description: "Newest token launches on Robinhood Chain", usage: "/launches?limit=10" },
  { slug: "token-risk", name: "Risk Checker", description: "Rug-risk check for a launchpad token", usage: "/risk/<token contract address>" },
  { slug: "token-lookup", name: "Token Lookup", description: "Price and market cap of any launchpad token", usage: "/price/<token contract address>" },
  { slug: "tx-explainer", name: "Tx Explainer", description: "Explains a transaction in plain words", usage: "/tx/<transaction hash>" },
  { slug: "wallet-portfolio", name: "Wallet Portfolio", description: "What a wallet holds", usage: "/portfolio/<wallet address>" },
  { slug: "page-reader", name: "Page Reader", description: "Reads a web page", usage: "/page?url=<url-encoded https:// link>" },
  { slug: "ostrapad-offer-finder", name: "Ostrapad Offer Finder", description: "Finds offers on Ostrapad", usage: "/offers?q=<what you need done>" },
  { slug: "holders-bundles", name: "Holders & Bundles", description: "Top holders and bundles", usage: "/holders/<token contract address>" },
  { slug: "dev-wallet", name: "Dev Wallet Tracker", description: "What the creator did", usage: "/dev/<token contract address>" },
  { slug: "payment-check", name: "Payment Check", description: "Did an x402 payment settle", usage: "/payment/<payment hash>" },
  { slug: "gas-now", name: "Gas Now", description: "Gas costs", usage: "/gas" },
  { slug: "website-check", name: "Website Check", description: "Trust check for a site", usage: "/site?url=<website or domain>" },
  { slug: "endpoint-health", name: "Endpoint Health", description: "Is an endpoint up", usage: "/endpoint?url=<url-encoded https:// link>" },
  { slug: "tokyo-futuro-job-finder", name: "Tokyo Futuro Job Finder", description: "Open paid jobs", usage: "/jobs?q=<the work>" },
].map((a) => ({ ...a, verified: true, price: { usdg: 0.01, autonomo: 100 }, trackRecord: { successRate: 1, paidCalls: 5 } }));

// A fake Autonomo: the gateway list, and a 402 price list (0.01 USDG unless told otherwise) for every /x/ URL.
function cli({ amount = "10000", env = {}, interactive = false, answer = true, store = memoryStore(), gloamOffer = null, startGloam } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const asked = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    if (new URL(String(url)).pathname === "/api/v1/gateways") return Response.json({ data: APIS });
    const accepts = [{ scheme: "exact", network: "eip155:4663", asset: USDG, amount, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } }];
    // The private option: the same price plus Gloam's fee, in USDG's 6 decimals.
    if (gloamOffer) accepts.push({ scheme: "gloam-cashout", network: "eip155:4663", asset: USDG, amount: gloamOffer, payTo: PAY_TO, maxTimeoutSeconds: 300 });
    return new Response("{}", { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify({ x402Version: 2, accepts })).toString("base64") } });
  };
  const io = { env, out: (t) => out.push(t), err: (t) => err.push(t), interactive, confirm: async (q) => (asked.push(q), answer), fetch, spendStore: store, startGloam };
  return { out, err, calls, asked, store, run: (...argv) => run(argv, io), paid: () => calls.some((c) => c.headers["PAYMENT-SIGNATURE"]) };
}
const priced = (c) => c.calls.filter((x) => x.url.includes("/x/")).map((x) => x.url.replace("https://autonomo.fun", ""));

test("help and version need nothing", async () => {
  const c = cli();
  assert.equal(await c.run("--help"), EXIT.ok);
  assert.match(c.out[0], /autonomo risk <token address>/);
  assert.equal(await c.run(), EXIT.ok);
  assert.equal(await c.run("--version"), EXIT.ok);
  assert.match(c.out.at(-1), /^\d+\.\d+\.\d+$/);
  assert.equal(c.calls.length, 0);
});

test("find lists matches without a wallet, as text or JSON", async () => {
  const c = cli();
  assert.equal(await c.run("find", "wallet holds"), EXIT.ok);
  assert.match(c.out[0], /^wallet-portfolio {2}0\.01 USDG or 100 AUTONOMO {2}verified/);
  const j = cli();
  assert.equal(await j.run("find", "--json"), EXIT.ok);
  assert.equal(JSON.parse(j.out[0]).length, APIS.length);
  const none = cli();
  assert.equal(await none.run("find", "zzzzzz"), EXIT.notFound);
});

test("each shortcut goes straight to its API and path", async () => {
  const cases = [
    [["price"], "/x/token-lookup/price/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96"],
    [["price", ADDR], `/x/token-lookup/price/${ADDR}`],
    [["launches"], "/x/new-launches/launches?limit=10"],
    [["launches", "5"], "/x/new-launches/launches?limit=5"],
    [["risk", ADDR], `/x/token-risk/risk/${ADDR}`],
    [["tx", TX], `/x/tx-explainer/tx/${TX}`],
    [["portfolio", ADDR], `/x/wallet-portfolio/portfolio/${ADDR}`],
    [["read", "https://example.com/a?b=c"], "/x/page-reader/page?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc"],
    [["offers", "summarize", "a document"], "/x/ostrapad-offer-finder/offers?q=summarize%20a%20document"],
    [["holders", ADDR], `/x/holders-bundles/holders/${ADDR}`],
    [["dev", ADDR], `/x/dev-wallet/dev/${ADDR}`],
    [["payment", TX], `/x/payment-check/payment/${TX}`],
    [["gas"], "/x/gas-now/gas"],
    [["site", "example.com"], "/x/website-check/site?url=example.com"],
    [["health", "https://api.example.com/v1?x=1"], "/x/endpoint-health/endpoint?url=https%3A%2F%2Fapi.example.com%2Fv1%3Fx%3D1"],
    [["jobs", "write", "a summary"], "/x/tokyo-futuro-job-finder/jobs?q=write%20a%20summary"],
    // --chain is added to the path of the shortcuts that read a chain.
    [["risk", ADDR, "--chain", "base"], `/x/token-risk/risk/${ADDR}?chain=base`],
    [["launches", "5", "--chain", "base"], "/x/new-launches/launches?limit=5&chain=base"],
    [["gas", "--chain", "base"], "/x/gas-now/gas?chain=base"],
    [["price", ADDR, "--chain", "robinhood"], `/x/token-lookup/price/${ADDR}?chain=robinhood`],
  ];
  for (const [argv, path] of cases) {
    const c = cli();
    assert.equal(await c.run(...argv, "--dry-run"), EXIT.ok, argv.join(" "));
    assert.deepEqual(priced(c), [path]);
    assert.match(c.out.join("\n"), /0\.01 USDG/);
    assert.equal(c.paid(), false);
  }
});

test("quote finds the API from words and the kind of input", async () => {
  const c = cli();
  assert.equal(await c.run("quote", "explain this transaction", TX, "--json"), EXIT.ok);
  const q = JSON.parse(c.out[0]);
  assert.equal(q.api.slug, "tx-explainer");
  assert.deepEqual(q.offers, [{ scheme: "exact", token: "USDG", amount: "0.01", private: false }]);
  const s = cli();
  assert.equal(await s.run("quote", "--slug", "token-risk", "--path", `/risk/${ADDR}`), EXIT.ok);
  assert.deepEqual(priced(s), [`/x/token-risk/risk/${ADDR}`]);
});

test("bad usage is caught before any request", async () => {
  for (const argv of [["risk"], ["risk", "0x123"], ["tx", ADDR], ["read", "http://example.com"], ["launches", "many"], ["nonsense"], ["call"], ["call", "is", "this", "safe"], ["risk", ADDR, "--max", "lots"], ["risk", ADDR, "--pay-with", "eth"], ["risk", ADDR, "--bogus"], ["call", "x", "--path", "/a"]]) {
    const c = cli({ env: { AUTONOMO_WALLET_KEY: KEY } });
    assert.equal(await c.run(...argv), EXIT.usage, argv.join(" "));
    assert.equal(c.calls.length, 0, argv.join(" "));
    assert.match(c.err.join("\n"), /autonomo --help/);
  }
});

test("the wallet key is never taken as a flag", async () => {
  const c = cli();
  assert.equal(await c.run("risk", ADDR, "--key", KEY), EXIT.usage);
  assert.match(c.err[0], /AUTONOMO_WALLET_KEY/);
  assert.ok(!c.err.join("").includes(KEY));
});

test("a paid call without a wallet stops before any request", async () => {
  const c = cli();
  assert.equal(await c.run("risk", ADDR), EXIT.cannotPay);
  assert.match(c.err[0], /AUTONOMO_WALLET_KEY/);
  assert.equal(c.calls.length, 0);
});

test("a price over --max is refused before anything is signed", async () => {
  const c = cli({ env: { AUTONOMO_WALLET_KEY: KEY } });
  assert.equal(await c.run("risk", ADDR, "--max", "0.005", "--pay-with", "usdg"), EXIT.overLimit);
  assert.match(c.err[0], /per-call cap of 0\.005 USDG/);
  assert.equal(c.paid(), false);
  const j = cli({ env: { AUTONOMO_WALLET_KEY: KEY } });
  assert.equal(await j.run("risk", ADDR, "--max", "0.005", "--pay-with", "usdg", "--json"), EXIT.overLimit);
  assert.equal(JSON.parse(j.err[0]).error.code, "cannot_pay");
  assert.equal(j.out.length, 0, "stdout stays empty on an error");
});

test("a call past --daily is refused", async () => {
  const store = memoryStore();
  store.add(new Date().toISOString().slice(0, 10), "usdg", 95_000n); // 0.095 USDG
  const c = cli({ env: { AUTONOMO_WALLET_KEY: KEY }, store });
  assert.equal(await c.run("launches", "--daily", "0.1", "--pay-with", "usdg"), EXIT.overLimit);
  assert.match(c.err[0], /budget \(0\.095 of 0\.1 spent\)/);
  assert.equal(c.paid(), false);
});

test("at a terminal it shows the price and asks first; no means nothing is paid", async () => {
  const c = cli({ env: { AUTONOMO_WALLET_KEY: KEY }, interactive: true, answer: false });
  assert.equal(await c.run("risk", ADDR), EXIT.ok);
  assert.match(c.asked[0], /^Risk Checker costs 0\.01 USDG\. Pay from 0x[0-9a-fA-F]{40}\? \[y\/N\] $/);
  assert.deepEqual(c.err, ["Not paid."]);
  assert.equal(c.paid(), false);
  assert.equal(c.out.length, 0);
});

test("--yes and scripts aren't asked", async () => {
  // Over the cap, so each stops at the limit check: what matters is that no question came first.
  const yes = cli({ env: { AUTONOMO_WALLET_KEY: KEY }, interactive: true });
  assert.equal(await yes.run("risk", ADDR, "--yes", "--max", "0.005", "--pay-with", "usdg"), EXIT.overLimit);
  assert.equal(yes.asked.length, 0);
  const script = cli({ env: { AUTONOMO_WALLET_KEY: KEY } });
  assert.equal(await script.run("risk", ADDR, "--max", "0.005", "--pay-with", "usdg"), EXIT.overLimit);
  assert.equal(script.asked.length, 0);
});

test("spend shows today's total against the limits", async () => {
  const store = memoryStore();
  store.add(new Date().toISOString().slice(0, 10), "usdg", 20_000n);
  store.add(new Date().toISOString().slice(0, 10), "usdc", 10_000n);
  const c = cli({ env: { AUTONOMO_WALLET_KEY: KEY }, store });
  assert.equal(await c.run("spend", "--daily", "2", "--json"), EXIT.ok);
  const r = JSON.parse(c.out[0]);
  // USDG and USDC on Base share the dollar limits.
  assert.deepEqual(r.usdg, { spent: "0.03", daily: "2", perCall: "0.05" });
  assert.deepEqual(r.spentByToken, { usdg: "0.02", usdcBase: "0.01", autonomo: "0" });
  assert.deepEqual(r.autonomo, { spent: "0", daily: "10000", perCall: "5000" });
  assert.match(r.wallet, /^0x[0-9a-fA-F]{40}$/);
  const t = cli({ store });
  assert.equal(await t.run("spend"), EXIT.ok);
  assert.match(t.out.join("\n"), /Dollars {3}0\.03 of 1 spent \(USDG 0\.02, USDC on Base 0\.01\), up to 0\.05 a call[\s\S]*none set/);
  assert.equal(t.calls.length, 0);
});

// ---------- --private: paying through Gloam ----------

// A stand-in for a running Gloam server: records what it was asked and answers as told.
function fakeGloam(answer = { status: "ok", hash: TX, body: JSON.stringify({ risk: "low" }), httpStatus: 200 }) {
  const state = { started: 0, closed: 0, asked: [] };
  const start = async () => {
    state.started++;
    return { fetchPaid: async (args) => (state.asked.push(args), answer), close: async () => void state.closed++ };
  };
  return { state, start };
}
const spentToday = async (c) => (await c.store.get(new Date().toISOString().slice(0, 10))).usdg ?? 0n;

test("--private pays through Gloam with no wallet key, counts it, and stops Gloam's server", async () => {
  const g = fakeGloam();
  const c = cli({ gloamOffer: "10928", startGloam: g.start });
  assert.equal(await c.run("risk", ADDR, "--private"), EXIT.ok);
  assert.deepEqual(g.state.asked, [{ url: `https://autonomo.fun/x/token-risk/risk/${ADDR}`, maxAmount: 0.011928, prefer: "gloam-cashout" }]);
  assert.deepEqual(JSON.parse(c.out[0]), { risk: "low" });
  assert.match(c.err.join("\n"), /Paying privately through Gloam/);
  assert.match(c.err.join("\n"), /Paid 0\.010928 USDG privately through Gloam to Risk Checker\. Today: 0\.010928 of 1 USDG and USDC./);
  assert.match(c.err.join("\n"), new RegExp(`/tx/${TX}`));
  assert.equal(c.paid(), false); // The wallet signed nothing.
  assert.equal(await spentToday(c), 10928n);
  assert.deepEqual([g.state.started, g.state.closed], [1, 1]);
});

test("--private --json prints one object and keeps stderr quiet", async () => {
  const g = fakeGloam();
  const c = cli({ gloamOffer: "10928", startGloam: g.start });
  assert.equal(await c.run("risk", ADDR, "--private", "--json"), EXIT.ok);
  const { data, receipt } = JSON.parse(c.out[0]);
  assert.deepEqual(data, { risk: "low" });
  assert.equal(receipt.route, "gloam");
  assert.equal(receipt.payer, "private (Gloam)");
  assert.deepEqual(c.err, []);
});

test("--private asks first at a terminal, with the private price, and a no starts nothing", async () => {
  const g = fakeGloam();
  const c = cli({ gloamOffer: "10928", startGloam: g.start, interactive: true, answer: false });
  assert.equal(await c.run("risk", ADDR, "--private"), EXIT.ok);
  assert.match(c.asked[0], /Risk Checker costs 0\.010928 USDG privately through Gloam, its fee included\. Pay from your Gloam balance\?/);
  assert.equal(g.state.started, 0);
  assert.match(c.err.join("\n"), /Not paid/);
});

test("--private never starts Gloam when the API has no private option or the price is over a limit", async () => {
  const none = fakeGloam();
  const a = cli({ startGloam: none.start });
  assert.equal(await a.run("risk", ADDR, "--private"), EXIT.cannotPay);
  assert.match(a.err.join("\n"), /doesn't offer private payment/);
  assert.equal(none.state.started, 0);

  const over = fakeGloam();
  const b = cli({ gloamOffer: "10928", startGloam: over.start });
  assert.equal(await b.run("risk", ADDR, "--private", "--max", "0.01"), EXIT.overLimit);
  assert.equal(over.state.started, 0);
});

test("--private reports a Gloam that won't start, one that refuses, and one that paid without an answer", async () => {
  const a = cli({ gloamOffer: "10928", startGloam: async () => Promise.reject(new Error("Gloam's server stopped (exit 1): GLOAM_AGENT_PRIVATE_KEY is not set")) });
  assert.equal(await a.run("risk", ADDR, "--private"), EXIT.cannotPay);
  assert.match(a.err.join("\n"), /GLOAM_AGENT_PRIVATE_KEY is not set .*~\/\.gloam\/agent\.env/);

  const refused = fakeGloam({ status: "error", message: "No private balance" });
  const b = cli({ gloamOffer: "10928", startGloam: refused.start });
  assert.equal(await b.run("risk", ADDR, "--private"), EXIT.refused);
  assert.match(b.err.join("\n"), /Gloam didn't pay: No private balance/);
  assert.equal(await spentToday(b), 0n);
  assert.equal(refused.state.closed, 1);

  const half = fakeGloam({ status: "paid_not_served", message: "The API timed out.", paymentHeader: "HDR123" });
  const d = cli({ gloamOffer: "10928", startGloam: half.start });
  assert.equal(await d.run("risk", ADDR, "--private"), EXIT.refused);
  assert.match(d.err.join("\n"), /HDR123/);
  assert.equal(await spentToday(d), 10928n); // It was paid, so it counts.
});

test("--retry-header presents the earlier payment instead of paying again", async () => {
  const g = fakeGloam();
  const c = cli({ gloamOffer: "10928", startGloam: g.start });
  assert.equal(await c.run("risk", ADDR, "--private", "--retry-header", "HDR123"), EXIT.ok);
  assert.deepEqual(g.state.asked, [{ url: `https://autonomo.fun/x/token-risk/risk/${ADDR}`, paymentHeader: "HDR123", prefer: "gloam-cashout" }]);
  assert.deepEqual(JSON.parse(c.out[0]), { risk: "low" });
  assert.match(c.err.join("\n"), /Nothing more was paid/);
  assert.equal(await spentToday(c), 0n);

  const still = fakeGloam({ status: "paid_not_served", message: "Still timing out." });
  const d = cli({ gloamOffer: "10928", startGloam: still.start });
  assert.equal(await d.run("risk", ADDR, "--private", "--retry-header", "HDR123"), EXIT.refused);
  assert.match(d.err.join("\n"), /Not answered yet: Still timing out/);
});

test("--private can't be mixed with other ways to pay, and --retry-header needs it", async () => {
  for (const extra of [["--pay-with", "autonomo"], ["--borro", PAY_TO]]) {
    const c = cli({ gloamOffer: "10928", startGloam: fakeGloam().start });
    assert.equal(await c.run("risk", ADDR, "--private", ...extra), EXIT.usage);
  }
  const c = cli();
  assert.equal(await c.run("risk", ADDR, "--retry-header", "HDR123"), EXIT.usage);
  assert.equal(c.calls.length, 0);
});

test("--private --dry-run only shows the prices", async () => {
  const g = fakeGloam();
  const c = cli({ gloamOffer: "10928", startGloam: g.start });
  assert.equal(await c.run("risk", ADDR, "--private", "--dry-run"), EXIT.ok);
  assert.match(c.out.join("\n"), /0\.010928 USDG {2}private, through Gloam/);
  assert.equal(g.state.started, 0);
});

// ---------- --chain and wallet ----------

test("--chain is refused where it means nothing", async () => {
  for (const argv of [
    ["risk", ADDR, "--chain", "solana"],
    ["price", "--chain", "base"],
    ["read", "https://example.com", "--chain", "base"],
    ["jobs", "write a summary", "--chain", "base"],
    ["call", "newest launches", "--chain", "base"],
  ]) {
    const c = cli();
    assert.equal(await c.run(...argv, "--dry-run"), EXIT.usage, argv.join(" "));
    assert.equal(c.calls.filter((x) => x.url.includes("/x/")).length, 0);
  }
});

test("the new shortcuts check what they are given", async () => {
  for (const argv of [["holders"], ["dev", "0x12"], ["payment", ADDR], ["gas", "now"], ["site"], ["site", "not a site"], ["health", "http://plain.example.com"], ["jobs"]]) {
    const c = cli();
    assert.equal(await c.run(...argv, "--dry-run"), EXIT.usage, argv.join(" "));
  }
});

test("wallet shows what the wallet holds on both chains, and signs nothing", async () => {
  const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const AUTONOMO = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
  const hex = (n) => `0x${n.toString(16).padStart(64, "0")}`;
  const seen = [];
  const rpc = async (url, init = {}) => {
    const u = String(url);
    const body = JSON.parse(init.body);
    const one = (b) => {
      seen.push(b.method);
      if (b.method === "eth_getBalance") return { jsonrpc: "2.0", id: b.id, result: "0x0" };
      const to = b.params?.[0]?.to?.toLowerCase();
      const held = u.includes("base.org") ? (to === USDC_BASE ? 500_000n : 0n) : to === USDG.toLowerCase() ? 1_250_000n : to === AUTONOMO ? 4_500n * 10n ** 18n : 0n;
      return { jsonrpc: "2.0", id: b.id, result: hex(held) };
    };
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)));
  };
  const real = globalThis.fetch;
  globalThis.fetch = rpc; // viem reads the chains through the global fetch
  try {
    const c = cli({ env: { AUTONOMO_WALLET_KEY: KEY } });
    assert.equal(await c.run("wallet"), EXIT.ok);
    const text = c.out.join("\n");
    assert.match(text, /^Wallet 0x[0-9a-fA-F]{40}/);
    assert.match(text, /Robinhood Chain {2}1\.25 USDG, 4,500 AUTONOMO, 0 ETH/);
    assert.match(text, /Base {13}0\.5 USDC/);
    assert.match(c.err.join("\n"), /needs a little ETH/);
    const j = cli({ env: { AUTONOMO_WALLET_KEY: KEY } });
    assert.equal(await j.run("wallet", "--json"), EXIT.ok);
    const b = JSON.parse(j.out[0]);
    assert.deepEqual(b.robinhood, { usdg: "1.25", autonomo: "4500", eth: "0" });
    assert.deepEqual(b.base, { usdc: "0.5" });
    assert.equal(j.err.length, 0);
    assert.ok(seen.every((m) => m === "eth_call" || m === "eth_getBalance" || m === "eth_chainId"), "only reads");
  } finally {
    globalThis.fetch = real;
  }
  const none = cli();
  assert.equal(await none.run("wallet"), EXIT.cannotPay);
});
