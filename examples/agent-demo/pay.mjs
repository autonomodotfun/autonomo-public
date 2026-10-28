// Autonomo demo agent: pays for one call to an x402 gateway and prints what happened, step by step.
//
// Run from this folder after `npm install`:
//   npm run pay                     # pay in USDG (default), readable output for people
//   npm run pay:autonomo            # pay in $AUTONOMO (one-time Permit2 approval first)
//   node pay.mjs --url https://autonomo.fun/x/<slug>/<path>
//   node pay.mjs --quote --json     # only read the price (402), don't pay; one JSON object
//   node pay.mjs --json             # pay and print one JSON object (for AI agents such as Codex)
//
// Reads AGENT_PRIVATE_KEY (a dedicated test wallet) and optional GATEWAY_URL from .env in this folder.
// The key is never printed.

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatEther, formatUnits, http, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

// Minimal reader for .env in this folder (KEY=value lines).
const ENV = (() => {
  const out = {};
  try {
    for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // No .env yet; agentKey() explains what to do.
  }
  return out;
})();

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const PAY = arg("pay", "usdg").toLowerCase();
const TARGET = arg("url", ENV.GATEWAY_URL || "https://autonomo.fun/x/token-price/price/autonomo");
const JSON_MODE = flag("json");
const QUOTE_ONLY = flag("quote");

const NETWORK = "eip155:4663";
const USDG = { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG", decimals: 6, cap: 50_000n }; // $0.05 cap
const AUT = { address: "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96", symbol: "AUTONOMO", decimals: 18, cap: 5_000n * 10n ** 18n }; // 5,000 cap
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

// People get colours and short pauses; JSON mode prints nothing until the single result object.
const c = {
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = (...a) => {
  if (!JSON_MODE) console.log(...a);
};
const step = async (n, text) => {
  if (JSON_MODE) return;
  console.log(`\n${c.y(`[${n}]`)} ${c.b(text)}`);
  await new Promise((r) => setTimeout(r, 600)); // readable on camera
};
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const decode = (h) => (h ? JSON.parse(Buffer.from(h, "base64").toString("utf8")) : null);
const tokenOf = (asset) => [USDG, AUT].find((t) => t.address.toLowerCase() === String(asset).toLowerCase());

class Stop extends Error {}
function fail(message, extra = {}) {
  throw Object.assign(new Stop(message), { extra });
}

function agentKey() {
  const key = ENV.AGENT_PRIVATE_KEY?.trim();
  if (!key) fail("Copy .env.example to .env in this folder and set AGENT_PRIVATE_KEY (a dedicated test wallet).");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("AGENT_PRIVATE_KEY should be 0x followed by 64 hex characters.");
  return key;
}

/** The 402 price list, as plain data. */
function offersFrom(required) {
  return required.accepts.map((a) => {
    const t = tokenOf(a.asset);
    return {
      token: t?.symbol ?? a.asset,
      amount: formatUnits(BigInt(a.amount), t?.decimals ?? 18),
      network: a.network,
      payTo: a.payTo,
      method: a.extra?.assetTransferMethod === "permit2" ? "permit2" : "eip3009",
    };
  });
}

async function run() {
  if (!["usdg", "autonomo"].includes(PAY)) fail("--pay must be usdg or autonomo");
  const token = PAY === "usdg" ? USDG : AUT;

  log(c.b("\n🤖 Autonomo demo agent"));
  log(c.d(`   Task: ${QUOTE_ONLY ? "check the price of" : "buy"} one API call, paying in ${token.symbol}`));

  // Quote mode needs no wallet: it only reads the 402.
  if (QUOTE_ONLY) {
    await step(1, `Call the API without paying: GET ${TARGET.replace(/^https:\/\//, "")}`);
    const res = await fetch(TARGET);
    const required = decode(res.headers.get("payment-required"));
    if (res.status !== 402 || !required) fail(`Expected a 402, got ${res.status}.`, { status: res.status, body: (await res.text()).slice(0, 300) });
    const offers = offersFrom(required);
    for (const o of offers) log(`    price    ${o.amount} ${o.token}  ${c.d(`→ pays ${short(o.payTo)} on ${o.network}`)}`);
    return { ok: true, mode: "quote", url: TARGET, status: 402, description: required.resource?.description ?? null, offers };
  }

  const account = privateKeyToAccount(agentKey());
  const pub = createPublicClient({ chain: robinhood, transport: http() });

  await step(1, "Agent wallet");
  const [eth, bal] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  ]);
  log(`    address  ${account.address}`);
  log(`    ${token.symbol.padEnd(8)} ${formatUnits(bal, token.decimals)}`);
  log(`    ETH      ${formatEther(eth)} ${c.d("(only needed for the one-time $AUTONOMO approval)")}`);

  await step(2, `Call the API without paying: GET ${TARGET.replace(/^https:\/\//, "")}`);
  const first = await fetch(TARGET);
  const required = decode(first.headers.get("payment-required"));
  log(`    ← ${first.status === 402 ? c.y("402 Payment Required") : first.status}`);
  if (first.status !== 402 || !required) fail(`Expected a 402, got ${first.status}.`, { status: first.status, body: (await first.text()).slice(0, 300) });
  const offers = offersFrom(required);
  for (const o of offers) log(`    price    ${o.amount} ${o.token}  ${c.d(`→ pays ${short(o.payTo)} on ${o.network}`)}`);
  const choice = required.accepts.find((a) => a.asset.toLowerCase() === token.address.toLowerCase());
  if (!choice) fail(`This API doesn't accept ${token.symbol}.`, { offers });
  if (bal < BigInt(choice.amount)) {
    fail(`Not enough ${token.symbol} in the agent wallet.`, {
      offers,
      balance: formatUnits(bal, token.decimals),
      needed: formatUnits(BigInt(choice.amount), token.decimals),
    });
  }

  let approveTx = null;
  if (choice.extra?.assetTransferMethod === "permit2") {
    await step("2b", "One-time Permit2 approval for $AUTONOMO");
    const allowance = await pub.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
    if (allowance >= BigInt(choice.amount)) {
      log(c.d("    Already approved."));
    } else {
      const wallet = createWalletClient({ account, chain: robinhood, transport: http() });
      approveTx = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
      log(`    approve tx ${c.d(`${EXPLORER}/tx/${approveTx}`)}`);
      await pub.waitForTransactionReceipt({ hash: approveTx });
      log(c.g("    ✓ Approved. Every payment after this is just a signature."));
    }
  }

  const paid = formatUnits(BigInt(choice.amount), token.decimals);
  await step(3, `Pay ${paid} ${token.symbol} with x402 and retry`);
  const signer = toClientEvmSigner(account, pub);
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer, { rpcUrl: RPC }) }],
    // Only these two tokens, each with a small cap per payment.
    spendControls: {
      allowedAssets: [USDG, AUT].map((t) => ({ network: NETWORK, asset: t.address, maxAmountPerPayment: t.cap.toString() })),
      maxAmountPerPayment: false,
    },
    paymentRequirementsSelector: (_v, reqs) => reqs.find((r) => r.asset.toLowerCase() === token.address.toLowerCase()) ?? reqs[0],
  });
  const res = await wrapFetchWithPayment(fetch, client)(TARGET);
  const settlement = decode(res.headers.get("payment-response"));
  log(`    ← ${res.status === 200 ? c.g("200 OK") : c.r(String(res.status))}`);
  if (res.status !== 200) {
    const reason = decode(res.headers.get("payment-required"))?.error;
    fail(reason ? `Payment rejected: ${reason}` : `Request failed with ${res.status}.`, { status: res.status });
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  await step(4, "What the agent bought");
  if (data && typeof data === "object" && "priceUsd" in data) {
    log(`    $AUTONOMO  ${c.g(`$${Number(data.priceUsd).toPrecision(3)}`)}  ${c.d(`(${Number(data.priceEth).toPrecision(3)} ETH)`)}`);
    if (data.lastTrade) log(c.d(`    from the last on-chain ${data.lastTrade.side} at ${data.lastTrade.time}`));
  } else {
    log(`    ${typeof data === "string" ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500)}`);
  }

  await step(5, "Payment settled on Robinhood Chain");
  const tx = settlement?.transaction ?? null;
  if (tx) {
    log(`    tx       ${tx}`);
    log(`    explorer ${c.y(`${EXPLORER}/tx/${tx}`)}`);
  } else {
    log(c.d("    (no settlement details returned)"));
  }
  log(c.b("\n✅ Done: an AI agent paid per call. No API key, no account.\n"));

  return {
    ok: true,
    mode: "pay",
    url: TARGET,
    paid: { amount: paid, token: token.symbol, network: NETWORK, payTo: choice.payTo, from: account.address },
    approveTx,
    settlement: tx ? { tx, explorer: `${EXPLORER}/tx/${tx}` } : null,
    data,
  };
}

run()
  .then((result) => {
    if (JSON_MODE) console.log(JSON.stringify(result, null, 2));
  })
  .catch((e) => {
    const message = e instanceof Stop ? e.message : e.shortMessage ?? e.message;
    if (JSON_MODE) console.log(JSON.stringify({ ok: false, error: message, ...(e.extra ?? {}) }, null, 2));
    else console.error(c.r(`\n✗ ${message}`));
    process.exit(1);
  });
