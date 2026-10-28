// Autonomo demo agent: pays for one call to an x402 gateway and prints what happened, step by step.
//
// Run from this folder after `npm install`:
//   npm run pay                     # pay in USDG (default)
//   npm run pay:autonomo            # pay in $AUTONOMO (one-time Permit2 approval first)
//   node pay.mjs --url https://autonomo.fun/x/<slug>/<path>
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
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PAY = arg("pay", "usdg").toLowerCase();
const TARGET = arg("url", ENV.GATEWAY_URL || "https://autonomo.fun/x/token-price/price/autonomo");

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

const c = {
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (n, text) => {
  console.log(`\n${c.y(`[${n}]`)} ${c.b(text)}`);
  await pause(600); // readable on camera
};
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const decode = (h) => (h ? JSON.parse(Buffer.from(h, "base64").toString("utf8")) : null);
const tokenOf = (asset) => [USDG, AUT].find((t) => t.address.toLowerCase() === String(asset).toLowerCase());

function agentKey() {
  const key = ENV.AGENT_PRIVATE_KEY?.trim();
  if (!key) {
    console.error(c.r("Copy .env.example to .env in this folder and set AGENT_PRIVATE_KEY (a dedicated test wallet)."));
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error(c.r("AGENT_PRIVATE_KEY should be 0x followed by 64 hex characters."));
    process.exit(1);
  }
  return key;
}

async function main() {
  if (!["usdg", "autonomo"].includes(PAY)) throw new Error("--pay must be usdg or autonomo");
  const account = privateKeyToAccount(agentKey());
  const pub = createPublicClient({ chain: robinhood, transport: http() });
  const token = PAY === "usdg" ? USDG : AUT;

  console.log(c.b("\n🤖 Autonomo demo agent"));
  console.log(c.d(`   Task: buy one live $AUTONOMO price lookup, paying in ${token.symbol}`));

  await step(1, "Agent wallet");
  const [eth, bal] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log(`    address  ${account.address}`);
  console.log(`    ${token.symbol.padEnd(8)} ${formatUnits(bal, token.decimals)}`);
  console.log(`    ETH      ${formatEther(eth)} ${c.d("(only needed for the one-time $AUTONOMO approval)")}`);

  await step(2, `Call the API without paying: GET ${TARGET.replace(/^https:\/\//, "")}`);
  const first = await fetch(TARGET);
  const required = decode(first.headers.get("payment-required"));
  console.log(`    ← ${first.status === 402 ? c.y("402 Payment Required") : first.status}`);
  if (first.status !== 402 || !required) {
    console.log(c.r(`    Expected a 402. Got: ${await first.text()}`));
    process.exit(1);
  }
  for (const a of required.accepts) {
    const t = tokenOf(a.asset);
    console.log(`    price    ${formatUnits(BigInt(a.amount), t?.decimals ?? 18)} ${t?.symbol ?? a.asset}  ${c.d(`→ pays ${short(a.payTo)} on ${a.network}`)}`);
  }
  const choice = required.accepts.find((a) => a.asset.toLowerCase() === token.address.toLowerCase());
  if (!choice) throw new Error(`This API doesn't accept ${token.symbol}.`);
  if (bal < BigInt(choice.amount)) throw new Error(`Not enough ${token.symbol} in the agent wallet.`);

  if (choice.extra?.assetTransferMethod === "permit2") {
    await step("2b", "One-time Permit2 approval for $AUTONOMO");
    const allowance = await pub.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
    if (allowance >= BigInt(choice.amount)) {
      console.log(c.d("    Already approved."));
    } else {
      const wallet = createWalletClient({ account, chain: robinhood, transport: http() });
      const hash = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
      console.log(`    approve tx ${c.d(`${EXPLORER}/tx/${hash}`)}`);
      await pub.waitForTransactionReceipt({ hash });
      console.log(c.g("    ✓ Approved. Every payment after this is just a signature."));
    }
  }

  await step(3, `Pay ${formatUnits(BigInt(choice.amount), token.decimals)} ${token.symbol} with x402 and retry`);
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
  console.log(`    ← ${res.status === 200 ? c.g("200 OK") : c.r(String(res.status))}`);
  if (res.status !== 200) {
    const reason = decode(res.headers.get("payment-required"))?.error;
    console.log(c.r(`    ${reason ? `Payment rejected: ${reason}` : await res.text()}`));
    process.exit(1);
  }
  const body = await res.json();

  await step(4, "What the agent bought");
  console.log(`    $AUTONOMO  ${c.g(`$${Number(body.priceUsd).toPrecision(3)}`)}  ${c.d(`(${Number(body.priceEth).toPrecision(3)} ETH)`)}`);
  if (body.lastTrade) console.log(c.d(`    from the last on-chain ${body.lastTrade.side} at ${body.lastTrade.time}`));

  await step(5, "Payment settled on Robinhood Chain");
  if (settlement?.transaction) {
    console.log(`    tx       ${settlement.transaction}`);
    console.log(`    explorer ${c.y(`${EXPLORER}/tx/${settlement.transaction}`)}`);
  } else {
    console.log(c.d("    (no settlement details returned)"));
  }
  console.log(c.b("\n✅ Done: an AI agent paid per call. No API key, no account.\n"));
}

main().catch((e) => {
  console.error(c.r(`\n✗ ${e.shortMessage ?? e.message}`));
  process.exit(1);
});
