// The two examples on /docs/http, run as they are against a stand-in API on this machine. Each payment they send is
// compared with what the official x402 client makes for the same wallet, price list, time and nonce: they must be
// the same, field for field and signature for signature. No network, no real wallet: the key is made here.
// Run: npx tsx --conditions=react-server --test src/app/docs/http/pay.test.ts
// The Python example runs when a Python with eth-account is found (PAY_TEST_PYTHON, python3 or python).

import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { mock, test } from "node:test";
import { x402Client } from "@x402/core/client";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { PaymentPayloadV2Schema } from "@x402/core/schemas";
import type { Network, PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { hexToBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const here = join(process.cwd(), "src", "app", "docs", "http");
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
const TX = `0x${"ab".repeat(32)}`;

const USDG = { scheme: "exact", network: "eip155:4663", amount: "5000", asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", payTo: "0xc5675fD446E280BD0e5bC51C9D33B6CA66e0789E", maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } };
const TOKEN = { scheme: "exact", network: "eip155:4663", amount: "15000000000000000000", asset: "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96", payTo: USDG.payTo, maxTimeoutSeconds: 300, extra: { assetTransferMethod: "permit2" } };
const USDC = { scheme: "exact", network: "eip155:8453", amount: "5000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x92a99FBD386F87277b6009BFF4C56728Ec5f7354", maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } };
type Offer = typeof USDG | typeof TOKEN | typeof USDC;

type Seen = { method: string; url: string; payment: string | null };

/** A stand-in for a paid API: 402 with the price list, then 200 with a receipt (or 402 again, with `refuse`). */
async function standIn(accepts: Offer[], refuse?: string) {
  const seen: Seen[] = [];
  const required = (req: IncomingMessage, error: string) => ({
    x402Version: 2,
    error,
    resource: { url: `http://${req.headers.host}${req.url}`, description: "A stand-in API", mimeType: "application/json" },
    accepts,
    extensions: { bazaar: { info: { input: { type: "http", method: "GET" } } } },
  });
  const server = createServer((req, res) => {
    const header = req.headers["payment-signature"];
    const payment = typeof header === "string" ? header : null;
    seen.push({ method: req.method ?? "", url: req.url ?? "", payment });
    if (!payment || refuse) {
      res.writeHead(402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required(req, payment ? refuse! : "Payment required") as PaymentRequired) });
      return res.end();
    }
    const paid = decodePaymentSignatureHeader(payment);
    res.writeHead(200, {
      "content-type": "application/json",
      "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: TX, network: paid.accepted.network, payer: account.address }),
    });
    res.end(JSON.stringify({ gasPrice: "0.1 gwei" }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x/gas-now/gas?chain=base`;
  return { url, seen, required, close: () => new Promise((done) => server.close(done)) };
}

type Run = { code: number; out: string; err: string };
const run = (command: string, args: string[], env: Record<string, string>) =>
  new Promise<Run>((done) => {
    const { PAY_NETWORK: _unset, ...clean } = process.env;
    execFile(command, args, { env: { ...clean, ...env, AUTONOMO_WALLET_KEY: key }, timeout: 60_000 }, (error, out, err) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out, err });
    });
  });

/** What the official x402 client sends for this price list, at the same moment and with the same nonce. */
async function official(required: PaymentRequired, offer: Offer, ours: { validBefore: string; nonce: Hex }) {
  // The client's own spending rules are off: by default it refuses any token that isn't on its built-in list.
  const client = x402Client.fromConfig({
    schemes: [{ network: offer.network as Network, client: new ExactEvmScheme(toClientEvmSigner(account)) }],
    spendControls: false,
  });
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

function findPython(): string | null {
  for (const name of [process.env.PAY_TEST_PYTHON, "python3", "python"]) {
    if (name && spawnSync(name, ["-c", "import eth_account"], { stdio: "ignore" }).status === 0) return name;
  }
  return null;
}
const python = findPython();

const EXAMPLES = [
  { name: "pay.mjs", command: process.execPath as string | null, file: join(here, "pay.mjs") },
  { name: "pay.py", command: python, file: join(here, "pay.py") },
];

for (const example of EXAMPLES) {
  const skip = example.command ? false : "no Python with eth-account on this machine";
  const go = (url: string, env: Record<string, string> = {}) => run(example.command!, [example.file, url], env);

  for (const [label, network, offer] of [
    ["USDG on Robinhood Chain", "", USDG],
    ["USDC on Base", "eip155:8453", USDC],
  ] as const) {
    test(`${example.name} pays with ${label}, the same payment the official client makes`, { skip }, async () => {
      const api = await standIn([USDG, TOKEN, USDC]);
      try {
        const before = Math.floor(Date.now() / 1000);
        const result = await go(api.url, network ? { PAY_NETWORK: network } : {});
        assert.equal(result.code, 0, result.err);
        assert.match(result.out, /200 \{"gasPrice": ?"0\.1 gwei"\}/, "the API's answer is printed");
        assert.match(result.out, new RegExp(`Paid \\$0\\.005\\. Transaction: ${TX}`), "and the receipt");
        assert.ok(!(result.out + result.err).includes(key.slice(2)), "the key is never printed");

        assert.equal(api.seen.length, 2, "two requests: one for the price, one with the payment");
        const [ask, pay] = api.seen;
        assert.equal(ask.payment, null);
        assert.deepEqual([pay.method, pay.url], [ask.method, ask.url], "the second request is the first one again");

        const sent = decodePaymentSignatureHeader(pay.payment!);
        PaymentPayloadV2Schema.parse(sent);
        assert.deepEqual(sent.accepted, offer, "the chosen option goes back unchanged");
        const auth = sent.payload.authorization as Record<string, string>;
        assert.deepEqual([auth.from, auth.to, auth.value, auth.validAfter], [account.address, offer.payTo, offer.amount, "0"]);
        const life = Number(auth.validBefore) - before;
        assert.ok(life >= offer.maxTimeoutSeconds && life <= offer.maxTimeoutSeconds + 60, `valid for ${life} s`);
        assert.match(auth.nonce, /^0x[0-9a-f]{64}$/);

        const required = api.required({ headers: { host: new URL(api.url).host }, url: ask.url } as IncomingMessage, "Payment required") as PaymentRequired;
        const theirs = await official(required, offer, { validBefore: auth.validBefore, nonce: auth.nonce as Hex });
        assert.deepEqual(sent, JSON.parse(JSON.stringify(theirs)));
      } finally {
        await api.close();
      }
    });
  }

  test(`${example.name} uses a new nonce for every payment`, { skip }, async () => {
    const api = await standIn([USDG]);
    try {
      await go(api.url);
      await go(api.url);
      const nonces = api.seen.filter((s) => s.payment).map((s) => (decodePaymentSignatureHeader(s.payment!).payload.authorization as { nonce: string }).nonce);
      assert.equal(new Set(nonces).size, 2);
    } finally {
      await api.close();
    }
  });

  test(`${example.name} signs nothing when the price is over its limit`, { skip }, async () => {
    const api = await standIn([{ ...USDG, amount: "600000" }]);
    try {
      const result = await go(api.url);
      assert.notEqual(result.code, 0);
      assert.match(result.err, /over the limit/);
      assert.equal(api.seen.length, 1, "no second request");
    } finally {
      await api.close();
    }
  });

  test(`${example.name} signs nothing for a token it was not told to pay with`, { skip }, async () => {
    const lookalike = { ...USDG, asset: "0x1111111111111111111111111111111111111111" };
    const api = await standIn([lookalike, TOKEN, USDC]);
    try {
      const result = await go(api.url);
      assert.notEqual(result.code, 0);
      assert.match(result.err, /no one-signature price on eip155:4663/);
      assert.equal(api.seen.length, 1, "no second request");
    } finally {
      await api.close();
    }
  });

  test(`${example.name} says why when the payment is refused`, { skip }, async () => {
    const api = await standIn([USDG], "insufficient_funds");
    try {
      const result = await go(api.url);
      assert.notEqual(result.code, 0);
      assert.match(result.err, /Not paid: insufficient_funds/);
    } finally {
      await api.close();
    }
  });

  test(`${example.name} asks for a key and an address instead of failing oddly`, { skip }, async () => {
    const result = await new Promise<Run>((done) => {
      execFile(example.command!, [example.file], { env: { ...process.env, AUTONOMO_WALLET_KEY: "" } }, (error, out, err) => done({ code: error ? 1 : 0, out, err }));
    });
    assert.equal(result.code, 1);
    assert.match(result.err, /Usage: AUTONOMO_WALLET_KEY=/);
  });
}

// The sample in the agents guide ("Pay from your own code") uses the official client. That client pays only tokens on
// its own list, and USDG on Robinhood Chain is not on it, so the sample has to allow USDG. If the client's list or
// its rules change, this says so.
test("the official client pays USDG only once it is allowed, the way the agents guide's sample allows it", async () => {
  const guide = readFileSync(join(process.cwd(), "src", "app", "docs", "agents", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(
    guide.includes('client.setSpendControls({\n  allowedAssets: [{ network: "eip155:4663", asset: "${USDG}", maxAmountPerPayment: "500000" }],\n});'),
    "the sample allows USDG, up to $0.50 a call",
  );
  assert.ok(guide.includes(`const USDG = "${USDG.asset}";`));

  const client = (allowUsdg: boolean) => {
    const made = new x402Client();
    made.register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account)));
    if (allowUsdg) made.setSpendControls({ allowedAssets: [{ network: "eip155:4663", asset: USDG.asset, maxAmountPerPayment: "500000" }] });
    return made;
  };
  const list = (accepts: Offer[]) => ({ x402Version: 2, resource: { url: "http://127.0.0.1/x", description: "", mimeType: "application/json" }, accepts }) as PaymentRequired;
  const chosen = async (allowUsdg: boolean, accepts: Offer[]) => (await client(allowUsdg).createPaymentPayload(list(accepts))).accepted.asset;

  assert.equal(await chosen(true, [USDG, TOKEN, USDC]), USDG.asset, "allowed: USDG, the first option");
  assert.equal(await chosen(true, [USDC]), USDC.asset, "allowed: USDC on Base still works");
  await assert.rejects(chosen(true, [{ ...USDG, amount: "600000" }]), /maxAmountPerPayment/, "allowed: not over the limit");
  assert.equal(await chosen(false, [USDG, TOKEN, USDC]), USDC.asset, "not allowed: it pays USDC on Base instead");
  await assert.rejects(chosen(false, [USDG]), /spendControls/, "not allowed: a USDG price is refused");
});
