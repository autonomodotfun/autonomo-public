// The example on /docs/router, run as it is against a stand-in router on this machine. The stand-in answers the way
// the real one does (src/lib/router/router.ts): a 402 with a route id, then a checked answer, or a 502 or 503 that
// names what to pay next. The first payment is compared with what the official x402 client makes. No network and no
// real wallet: the key is made here.
// Run: npx tsx --conditions=react-server --test src/app/docs/router/route.test.ts

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { mock, test } from "node:test";
import { x402Client } from "@x402/core/client";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { Network, PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { hexToBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CAPABILITIES, CAPABILITY_INPUTS, ROUTER } from "@/lib/router/router";

const here = join(process.cwd(), "src", "app", "docs", "router");
const file = join(here, "route.mjs");
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
const TX = `0x${"cd".repeat(32)}`;
const TOKEN = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";

const usdg = (payTo: string, amount = "10000") => ({ scheme: "exact", network: "eip155:4663", amount, asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", payTo, maxTimeoutSeconds: 85, extra: { name: "Global Dollar", version: "1" } });
const PAY_A = "0xc5675fD446E280BD0e5bC51C9D33B6CA66e0789E";
const PAY_B = "0x92a99FBD386F87277b6009BFF4C56728Ec5f7354";
type Offer = ReturnType<typeof usdg>;

/** One API the stand-in router can pick: its name, where it is paid, and what a paid call to it comes back with. */
type Pick = { api: string; offer: Offer; answer: "ok" | "failed" | "not_ready" | "refused"; wait?: number; bonded?: boolean };
type Seen = { url: string; payment: string | null; routeId: string | null; at: number };

/**
 * A stand-in for /route. `first` is what an unpaid request gets: the first pick's 402, or a status and a body.
 * `picks` are the APIs in the order the router offers them: each paid call is answered by the pick its route id names.
 */
async function standIn(picks: Pick[], first?: { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const required = (req: IncomingMessage, pick: Pick, error = "Payment required") => ({
    x402Version: 2,
    error,
    resource: { url: `http://${req.headers.host}${req.url}`, description: "A routed API", mimeType: "application/json" },
    accepts: [pick.offer],
    extensions: { bazaar: { info: { input: { type: "http", method: "GET" } } } },
  });
  const routeId = (i: number) => `route-${i + 1}`;
  const next = (req: IncomingMessage, i: number) => ({ ...required(req, picks[i]), route_id: routeId(i), routed_to: picks[i].api });
  const json = { "content-type": "application/json" };

  const server = createServer((req, res) => {
    const header = req.headers["payment-signature"];
    const payment = typeof header === "string" ? header : null;
    const id = typeof req.headers["x-autonomo-route-id"] === "string" ? (req.headers["x-autonomo-route-id"] as string) : null;
    seen.push({ url: req.url ?? "", payment, routeId: id, at: Date.now() });

    if (!payment) {
      if (first) {
        res.writeHead(first.status, json);
        return res.end(JSON.stringify(first.body));
      }
      res.writeHead(402, { ...json, "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required(req, picks[0]) as PaymentRequired), "X-Autonomo-Route-Id": routeId(0), "X-Autonomo-Routed-To": picks[0].api });
      return res.end(JSON.stringify(next(req, 0)));
    }
    const i = picks.findIndex((_, n) => routeId(n) === id);
    if (i < 0) {
      res.writeHead(400, json);
      return res.end(JSON.stringify({ error: "route_id unknown, expired or already used: call /route again" }));
    }
    const pick = picks[i];
    if (pick.answer === "ok") {
      const paid = decodePaymentSignatureHeader(payment);
      res.writeHead(200, {
        ...json,
        "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: TX, network: paid.accepted.network, payer: account.address }),
        "X-Autonomo-Routed-To": pick.api,
        "X-Autonomo-Bonded": pick.bonded ? "true" : "false",
      });
      return res.end(JSON.stringify({ score: 12, level: "low", flags: [], raw: { risk: { score: 12 } } }));
    }
    if (pick.answer === "refused") {
      res.writeHead(402, { ...json, "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required(req, pick, "insufficient_funds") as PaymentRequired), "X-Autonomo-Route-Id": "route-again", "X-Autonomo-Routed-To": pick.api });
      return res.end(JSON.stringify({ ...next(req, i), route_id: "route-again", error: "payment not valid for this route" }));
    }
    const more = i + 1 < picks.length;
    if (pick.answer === "not_ready") {
      const seconds = pick.wait ?? 1;
      res.writeHead(503, { ...json, "Retry-After": String(seconds), ...(more ? { "X-Autonomo-Route-Id": routeId(i + 1), "X-Autonomo-Routed-To": picks[i + 1].api } : {}) });
      return res.end(JSON.stringify({ error: `${pick.api} is not ready yet, nothing was charged: call again in ${seconds} seconds`, retry_after_seconds: seconds, ...(more ? { next: next(req, i + 1) } : {}) }));
    }
    const failed = `${pick.api} failed (status 500), nothing was charged`;
    res.writeHead(502, { ...json, ...(more ? { "X-Autonomo-Route-Id": routeId(i + 1), "X-Autonomo-Routed-To": picks[i + 1].api } : {}) });
    res.end(JSON.stringify(more ? { error: failed, next: next(req, i + 1) } : { error: `${failed}, no other API left` }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen, required, close: () => new Promise((done) => server.close(done)) };
}

type Run = { code: number; out: string; err: string };
const run = (base: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<Run>((done) => {
    const { PAY_NETWORK: _unset, ...clean } = process.env;
    execFile(process.execPath, [file, ...args], { env: { ...clean, AUTONOMO_ROUTER: base, AUTONOMO_WALLET_KEY: key, ...env }, timeout: 60_000 }, (error, out, err) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out, err });
    });
  });
const paid = (seen: Seen[]) => seen.filter((s) => s.payment).map((s) => ({ ...s, sent: decodePaymentSignatureHeader(s.payment!) }));
const auth = (sent: ReturnType<typeof decodePaymentSignatureHeader>) => sent.payload.authorization as Record<string, string>;

/** What the official x402 client sends for this price list, at the same moment and with the same nonce. */
async function official(required: PaymentRequired, offer: Offer, ours: { validBefore: string; nonce: Hex }) {
  const client = x402Client.fromConfig({ schemes: [{ network: offer.network as Network, client: new ExactEvmScheme(toClientEvmSigner(account)) }], spendControls: false });
  const now = mock.method(Date, "now", () => (Number(ours.validBefore) - offer.maxTimeoutSeconds) * 1000);
  const random = mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    bytes.set(hexToBytes(ours.nonce));
    return bytes;
  });
  try {
    return await client.createPaymentPayload({ ...required, accepts: [offer] } as PaymentRequired);
  } finally {
    now.mock.restore();
    random.mock.restore();
  }
}

test("it asks, pays the API the router picked with the route id, and prints the checked answer", async () => {
  const router = await standIn([{ api: "token-risk", offer: usdg(PAY_A), answer: "ok" }]);
  try {
    const result = await run(router.base, ["token-risk", `token=${TOKEN}`, "chain=robinhood"]);
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /200 \{"score":12,"level":"low"/, "the answer is printed");
    assert.match(result.out, new RegExp(`Answered by token-risk\\. Paid \\$0\\.01\\. Transaction: ${TX}`));
    assert.ok(!(result.out + result.err).includes(key.slice(2)), "the key is never printed");

    assert.equal(router.seen.length, 2, "two requests: one to be given an API, one with the payment");
    const [ask, pay] = router.seen;
    assert.equal(ask.url, `/route/token-risk?token=${TOKEN}&chain=robinhood`);
    assert.deepEqual([ask.payment, ask.routeId], [null, null]);
    assert.equal(pay.url, ask.url, "the second request is the first one again");
    assert.equal(pay.routeId, "route-1", "with the route id it was given");

    const sent = decodePaymentSignatureHeader(pay.payment!);
    const a = auth(sent);
    assert.deepEqual([a.from, a.to, a.value], [account.address, PAY_A, "10000"]);
    assert.equal("route_id" in sent || "routed_to" in sent, false, "the router's own fields are not part of the payment");
    const required = router.required({ headers: { host: new URL(router.base).host }, url: ask.url } as IncomingMessage, { api: "token-risk", offer: usdg(PAY_A), answer: "ok" }) as PaymentRequired;
    const theirs = await official(required, usdg(PAY_A), { validBefore: a.validBefore, nonce: a.nonce as Hex });
    assert.deepEqual(sent, JSON.parse(JSON.stringify(theirs)), "the same payment the official x402 client makes");
  } finally {
    await router.close();
  }
});

test("when the picked API fails it pays the next one: a new signature, to that API's own address, with the new route id", async () => {
  const router = await standIn([
    { api: "risk-one", offer: usdg(PAY_A), answer: "failed" },
    { api: "risk-two", offer: usdg(PAY_B, "20000"), answer: "ok", bonded: true },
  ]);
  try {
    const result = await run(router.base, ["token-risk", `token=${TOKEN}`]);
    assert.equal(result.code, 0, result.err);
    assert.match(result.err, /risk-one: risk-one failed \(status 500\), nothing was charged/);
    assert.match(result.out, /Answered by risk-two, which has a bond locked\. Paid \$0\.02\./);
    const [one, two] = paid(router.seen);
    assert.equal(router.seen.length, 3);
    assert.deepEqual([one.routeId, auth(one.sent).to, auth(one.sent).value], ["route-1", PAY_A, "10000"]);
    assert.deepEqual([two.routeId, auth(two.sent).to, auth(two.sent).value], ["route-2", PAY_B, "20000"]);
    assert.notEqual(auth(one.sent).nonce, auth(two.sent).nonce, "a new nonce for the second payment");
    assert.equal(two.url, one.url);
  } finally {
    await router.close();
  }
});

test("when the API says it isn't ready it waits as long as it was told, then pays again", async () => {
  const router = await standIn([
    { api: "safe-swap", offer: usdg(PAY_A), answer: "not_ready", wait: 1 },
    { api: "safe-swap", offer: usdg(PAY_A), answer: "ok" },
  ]);
  try {
    const result = await run(router.base, ["swap-quote", "token_in=ETH", `token_out=${TOKEN}`, "amount=1000", `taker=${PAY_B}`]);
    assert.equal(result.code, 0, result.err);
    assert.match(result.err, /not ready yet, nothing was charged/);
    const [one, two] = paid(router.seen);
    assert.ok(two.at - one.at >= 950, `it waited ${two.at - one.at} ms`);
    assert.deepEqual([one.routeId, two.routeId], ["route-1", "route-2"]);
    assert.match(result.out, /Answered by safe-swap\./);
  } finally {
    await router.close();
  }
});

test("it gives up after three tries, and after a wait that is too long, without paying further", async () => {
  const failing = (n: number): Pick => ({ api: `api-${n}`, offer: usdg(PAY_A), answer: "failed" });
  const many = await standIn([failing(1), failing(2), failing(3), failing(4), { api: "api-5", offer: usdg(PAY_A), answer: "ok" }]);
  const slow = await standIn([
    { api: "slow", offer: usdg(PAY_A), answer: "not_ready", wait: 600 },
    { api: "slow", offer: usdg(PAY_A), answer: "ok" },
  ]);
  try {
    const result = await run(many.base, ["token-risk", `token=${TOKEN}`]);
    assert.equal(result.code, 1);
    assert.equal(paid(many.seen).length, 3, "three payments signed, none of them charged");
    assert.match(result.err, /502 api-3 failed \(status 500\), nothing was charged/);

    const waited = await run(slow.base, ["token-risk", `token=${TOKEN}`]);
    assert.equal(waited.code, 1);
    assert.equal(paid(slow.seen).length, 1, "it doesn't sit through a ten-minute wait");
    assert.match(waited.err, /503 slow is not ready yet/);
  } finally {
    await many.close();
    await slow.close();
  }
});

test("when no other API is left, it says so and stops", async () => {
  const router = await standIn([{ api: "only-one", offer: usdg(PAY_A), answer: "failed" }]);
  try {
    const result = await run(router.base, ["token-risk", `token=${TOKEN}`]);
    assert.equal(result.code, 1);
    assert.match(result.err, /502 only-one failed \(status 500\), nothing was charged, no other API left/);
    assert.equal(router.seen.length, 2);
  } finally {
    await router.close();
  }
});

test("a refused payment ends it with the reason: it doesn't sign again in a loop", async () => {
  const router = await standIn([{ api: "token-risk", offer: usdg(PAY_A), answer: "refused" }]);
  try {
    const result = await run(router.base, ["token-risk", `token=${TOKEN}`]);
    assert.equal(result.code, 1);
    assert.match(result.err, /Not paid: payment not valid for this route/);
    assert.equal(paid(router.seen).length, 1);
  } finally {
    await router.close();
  }
});

test("answers that need no payment are printed and nothing is signed", async () => {
  for (const [status, body, said] of [
    [503, { error: "no API can serve this right now", capability: "token-risk" }, /503 .*no API can serve this right now/],
    [404, { error: "unknown capability nothing", capabilities: Object.keys(CAPABILITIES).sort() }, /404 .*unknown capability nothing.*token-risk/],
    [400, { error: "missing input: token", inputs: ["token"] }, /400 .*missing input: token/],
    [429, { error: "too many requests: wait a minute" }, /429 .*too many requests/],
  ] as const) {
    const router = await standIn([], { status, body });
    try {
      const result = await run(router.base, ["token-risk"]);
      assert.equal(result.code, 1, String(status));
      assert.match(result.err, said);
      assert.equal(router.seen.length, 1, "one request, no payment");
      assert.equal(router.seen[0].payment, null);
    } finally {
      await router.close();
    }
  }
});

test("it signs nothing over its price limit, and nothing in a token it wasn't told to pay with", async () => {
  const dear = await standIn([{ api: "token-risk", offer: usdg(PAY_A, "600000"), answer: "ok" }]);
  const lookalike = await standIn([{ api: "token-risk", offer: { ...usdg(PAY_A), asset: "0x1111111111111111111111111111111111111111" }, answer: "ok" }]);
  try {
    const over = await run(dear.base, ["token-risk", `token=${TOKEN}`]);
    assert.notEqual(over.code, 0);
    assert.match(over.err, /over the limit/);
    assert.equal(dear.seen.length, 1, "no second request");
    const other = await run(lookalike.base, ["token-risk", `token=${TOKEN}`]);
    assert.notEqual(other.code, 0);
    assert.match(other.err, /no one-signature price on eip155:4663/);
    assert.equal(lookalike.seen.length, 1);
  } finally {
    await dear.close();
    await lookalike.close();
  }
});

test("inputs go into the address as they are, even with = and & in them", async () => {
  const router = await standIn([{ api: "website-check", offer: usdg(PAY_A), answer: "ok" }]);
  try {
    await run(router.base, ["website-check", "url=https://demo.xyz/a?x=1&y=2"]);
    const asked = new URL(router.seen[0].url, router.base);
    assert.equal(asked.pathname, "/route/website-check");
    assert.equal(asked.searchParams.get("url"), "https://demo.xyz/a?x=1&y=2");
  } finally {
    await router.close();
  }
});

test("it asks for a key and a service instead of failing oddly", async () => {
  const result = await new Promise<Run>((done) => {
    execFile(process.execPath, [file], { env: { ...process.env, AUTONOMO_WALLET_KEY: "" } }, (error, out, err) => done({ code: error ? 1 : 0, out, err }));
  });
  assert.equal(result.code, 1);
  assert.match(result.err, /Usage: AUTONOMO_WALLET_KEY=/);
});

// The guide's own facts, held to the router's code.
test("the guide lists every service with its inputs, and the limits it states are the router's", () => {
  const page = readFileSync(join(here, "page.tsx"), "utf8").replace(/\r\n/g, "\n");
  for (const service of Object.keys(CAPABILITY_INPUTS)) assert.ok(page.includes(`"${service}":`), `${service} has a line in the guide`);
  // The inputs each service needs and the fields it answers are printed from the router's own lists.
  assert.ok(page.includes("CAPABILITY_INPUTS[name]") && page.includes("Object.keys(CAPABILITIES[name])"));
  assert.equal(ROUTER.routeIdTtlMs, 60_000, "the guide says a route id lasts 60 seconds");
  assert.equal(ROUTER.ratePerIpPerMinute, 240, "the guide says 240 requests a minute from one address");
  assert.equal(ROUTER.ratePerPayerPerMinute, 60, "the guide says 60 paid calls a minute from one wallet");
  assert.equal(ROUTER.payerBlockMs, 24 * 60 * 60 * 1000, "the guide says a wallet is paused for 24 hours");
  assert.equal(ROUTER.notReadyMaxWaitMs, 120_000, "the guide and the example say a wait is 2 minutes at most");
  assert.equal(ROUTER.measuredWindow, 20);
  assert.equal(ROUTER.minAnswerRate, 0.95);
});
