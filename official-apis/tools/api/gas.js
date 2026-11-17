// Official Autonomo API: what things cost in gas on Robinhood Chain right now.
//
// GET /v1/gas   (header: x-api-key: <TOOLS_API_KEY>)
//
// The current gas price, and what four common actions cost at that price, in ETH and USD: sending ETH, sending
// USDG, buying on a launchpad curve and launching a token. The gas each action uses isn't guessed: it's the median
// of what recent real transactions of that kind used, read from their receipts. ETH/USD is Chainlink's feed on Base.
//
// Paying an Autonomo API costs the caller no gas at all: Autonomo's facilitator submits the payment.
//
// ?chain=base gives the same for Base: sending ETH, sending USDC, a Uniswap v4 swap and a Clanker launch, each
// including Base's charge for posting the transaction to Ethereum (the L1 fee, from the receipts it was measured
// on). Left out, it's Robinhood Chain, as before.

import { encodeFunctionData, parseAbi, toHex } from "viem";
import {
  authorized, badChain, BASE_LAUNCHPADS, BUY, chainNotReady, chainReady, chainRequest, CHAINS, ethUsd, FACTORY, getLogs, LAUNCHED, logsBetween, rh,
  sendJson, TRANSFER, USDG,
} from "./_lib.js";

const SPAN = 29_000n; // log queries without an address filter may span 30,000 blocks (about an hour)
const SAMPLES = 9; // recent transactions read for each action
const ERC20_TRANSFER = "0xa9059cbb"; // transfer(address,uint256)
const DEAD = "0x000000000000000000000000000000000000dEaD";
const PRICE_MS = 10_000;
const USAGE_MS = 5 * 60_000; // how much gas an action uses barely moves, so it's read less often

let priceCache = null;
let usageCache = null;

const median = (list) => {
  const s = [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Median gas used by the newest transactions behind these logs that pass `keep` (default: all of them). */
async function typicalGas(logs, keep) {
  // A filter throws most candidates away, so it looks at more of them.
  const hashes = [...new Set(logs.map((l) => l.transactionHash))].slice(-SAMPLES * (keep ? 5 : 2));
  const used = [];
  await Promise.all(
    hashes.map(async (hash) => {
      try {
        if (keep && !keep(await rh.getTransaction({ hash }))) return;
        const receipt = await rh.getTransactionReceipt({ hash });
        if (receipt.status === "success") used.push(receipt.gasUsed);
      } catch {
        // one unreadable sample doesn't matter
      }
    }),
  );
  return { gas: median(used.slice(0, SAMPLES)), samples: Math.min(used.length, SAMPLES) };
}

async function usage(latest) {
  if (usageCache && Date.now() - usageCache.at < USAGE_MS) return usageCache.value;
  const from = toHex(latest - SPAN);
  const to = toHex(latest);
  const [buys, launches, usdgMoves, sendEth] = await Promise.all([
    getLogs({ topics: [BUY], fromBlock: from, toBlock: to }).catch(() => []),
    getLogs({ address: FACTORY, topics: [LAUNCHED], fromBlock: toHex(latest - SPAN * 20n), toBlock: to }).catch(() => []),
    getLogs({ address: USDG, topics: [TRANSFER], fromBlock: toHex(latest - SPAN * 20n), toBlock: to }).catch(() => []),
    // A plain ETH send between two wallets. On this chain the estimate includes the cost of posting the data.
    rh.estimateGas({ account: DEAD, to: DEAD, value: 0n }).catch(() => null),
  ]);
  const [buy, launch, usdg] = await Promise.all([
    typicalGas(buys),
    typicalGas(launches),
    // Only plain transfers sent straight to the token, not USDG moving inside a bigger transaction.
    typicalGas(usdgMoves, (tx) => tx.to?.toLowerCase() === USDG && tx.input.startsWith(ERC20_TRANSFER)),
  ]);
  // No plain USDG transfer lately: ask the chain what one would use. Sending nothing needs no balance, and comes
  // out a little low because it writes no new balance.
  let sendUsdg = usdg;
  if (usdg.gas === null) {
    const data = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256)"]), functionName: "transfer", args: [DEAD, 0n] });
    const estimate = await rh.estimateGas({ account: DEAD, to: USDG, data }).catch(() => null);
    sendUsdg = { gas: estimate, samples: null };
  }
  const value = { sendEth: { gas: sendEth, samples: null }, sendUsdg, curveBuy: buy, launch };
  usageCache = { at: Date.now(), value };
  return value;
}

async function gasNow() {
  const [latest, gasPrice, eth] = await Promise.all([rh.getBlockNumber(), rh.getGasPrice(), ethUsd()]);
  const used = await usage(latest);
  const cost = (label, how, { gas, samples }) => {
    if (gas === null) return { action: label, gas: null, feeEth: null, feeUsd: null, basedOn: "no recent transactions to measure" };
    const feeEth = Number(gas * gasPrice) / 1e18;
    return { action: label, gas: Number(gas), feeEth, feeUsd: feeEth * eth, basedOn: samples === null ? how : `${how}, median of ${samples}` };
  };
  return {
    chain: "Robinhood Chain",
    gasPriceGwei: Number(gasPrice) / 1e9,
    ethUsd: eth,
    costs: [
      cost("Send ETH", "the chain's own estimate", used.sendEth),
      cost("Send USDG", used.sendUsdg.samples === null ? "the chain's own estimate, likely a little low" : "recent plain USDG transfers", used.sendUsdg),
      cost("Buy on a launchpad curve", "recent curve buys", used.curveBuy),
      cost("Launch a token", "recent launches, which often include a first buy", used.launch),
    ],
    payingAnAutonomoApi: "No gas for the caller: Autonomo's facilitator submits the payment. Paying in $AUTONOMO needs a one-time Permit2 approval, which costs about as much as sending USDG.",
    block: Number(latest),
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const asked = chainRequest(req.query);
  if (!asked) return sendJson(res, 400, badChain);
  if (!chainReady(asked.chain)) return sendJson(res, 503, chainNotReady);
  try {
    if (asked.chain === CHAINS.base) {
      if (basePriceCache && Date.now() - basePriceCache.at < PRICE_MS) return sendJson(res, 200, basePriceCache.body);
      const body = await baseGasNow();
      basePriceCache = { at: Date.now(), body };
      return sendJson(res, 200, body);
    }
    if (priceCache && Date.now() - priceCache.at < PRICE_MS) return sendJson(res, 200, priceCache.body);
    const body = await gasNow();
    priceCache = { at: Date.now(), body };
    return sendJson(res, 200, body);
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}

// ---- Base
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const GAS_ORACLE = "0x420000000000000000000000000000000000000F"; // Base's GasPriceOracle predeploy
const oracleAbi = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)"]);
const ETH_SEND_BYTES = 110n; // about the size of a signed plain ETH send
const BASE_RECENT = 20n; // blocks searched for busy kinds of transaction (40 seconds on Base)
const BASE_LAUNCHES = 43_200n; // a day, for Clanker launches
let basePriceCache = null;
let baseUsageCache = null;

/** Median gas used and median L1 fee of the newest successful transactions behind these logs that pass `keep`. */
async function typicalOnBase(logs, keep) {
  const client = CHAINS.base.client;
  const hashes = [...new Set(logs.map((l) => l.transactionHash))].slice(-SAMPLES * (keep ? 5 : 2));
  const used = [];
  await Promise.all(
    hashes.map(async (hash) => {
      try {
        if (keep && !keep(await client.getTransaction({ hash }))) return;
        const r = await client.getTransactionReceipt({ hash });
        if (r.status === "success") used.push({ gas: r.gasUsed, l1Fee: r.l1Fee ?? 0n });
      } catch {
        // one unreadable sample doesn't matter
      }
    }),
  );
  const kept = used.slice(0, SAMPLES);
  return { gas: median(kept.map((u) => u.gas)), l1Fee: median(kept.map((u) => u.l1Fee)), samples: kept.length };
}

async function baseUsage(latest) {
  if (baseUsageCache && Date.now() - baseUsageCache.at < USAGE_MS) return baseUsageCache.value;
  const chain = CHAINS.base;
  const client = chain.client;
  const v4 = BASE_LAUNCHPADS[0]; // Clanker v4, the busiest launchpad the API knows
  const [usdcMoves, swaps, launches, sendEthGas, sendEthL1] = await Promise.all([
    logsBetween({ address: USDC_BASE, topics: [TRANSFER] }, latest - BASE_RECENT, latest, chain).catch(() => []),
    logsBetween({ address: chain.poolManager, topics: [V4_SWAP] }, latest - BASE_RECENT, latest, chain).catch(() => []),
    logsBetween({ address: v4.factory, topics: [v4.topic0] }, latest - BASE_LAUNCHES, latest, chain).catch(() => []),
    client.estimateGas({ account: DEAD, to: DEAD, value: 0n }).catch(() => null),
    client.readContract({ address: GAS_ORACLE, abi: oracleAbi, functionName: "getL1FeeUpperBound", args: [ETH_SEND_BYTES] }).catch(() => null),
  ]);
  const [usdc, swap, launch] = await Promise.all([
    // Only plain transfers sent straight to USDC, not USDC moving inside a bigger transaction.
    typicalOnBase(usdcMoves, (tx) => tx.to?.toLowerCase() === USDC_BASE && tx.input.startsWith(ERC20_TRANSFER)),
    typicalOnBase(swaps),
    typicalOnBase(launches),
  ]);
  const value = { sendEth: { gas: sendEthGas, l1Fee: sendEthL1 ?? 0n, samples: null }, sendUsdc: usdc, swap, launch };
  baseUsageCache = { at: Date.now(), value };
  return value;
}

async function baseGasNow() {
  const client = CHAINS.base.client;
  const [latest, gasPrice, eth] = await Promise.all([client.getBlockNumber(), client.getGasPrice(), ethUsd()]);
  const used = await baseUsage(latest);
  const cost = (label, how, { gas, l1Fee, samples }) => {
    if (gas === null) return { action: label, gas: null, feeEth: null, feeUsd: null, l1FeeEth: null, basedOn: "no recent transactions to measure" };
    const feeEth = Number(gas * gasPrice + l1Fee) / 1e18;
    return { action: label, gas: Number(gas), feeEth, feeUsd: feeEth * eth, l1FeeEth: Number(l1Fee) / 1e18, basedOn: samples === null ? how : `${how}, median of ${samples}` };
  };
  return {
    chain: "Base",
    gasPriceGwei: Number(gasPrice) / 1e9,
    ethUsd: eth,
    costs: [
      cost("Send ETH", "the chain's own estimate, with the L1 fee's upper bound", used.sendEth),
      cost("Send USDC", "recent plain USDC transfers", used.sendUsdc),
      cost("Swap on Uniswap v4", "recent v4 swaps, through whatever router sent them", used.swap),
      cost("Launch a token on Clanker", "recent Clanker launches, which often include a first buy", used.launch),
    ],
    l1FeeNote: "Each fee includes Base's charge for posting the transaction to Ethereum (l1FeeEth).",
    payingAnAutonomoApi: "No gas for the caller: in USDC on Base, Coinbase's facilitator submits the payment.",
    block: Number(latest),
    updatedAt: new Date().toISOString(),
  };
}
