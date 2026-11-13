// Official Autonomo API: what things cost in gas on Robinhood Chain right now.
//
// GET /v1/gas   (header: x-api-key: <TOOLS_API_KEY>)
//
// The current gas price, and what four common actions cost at that price, in ETH and USD: sending ETH, sending
// USDG, buying on a launchpad curve and launching a token. The gas each action uses isn't guessed: it's the median
// of what recent real transactions of that kind used, read from their receipts. ETH/USD is Chainlink's feed on Base.
//
// Paying an Autonomo API costs the caller no gas at all: Autonomo's facilitator submits the payment.

import { encodeFunctionData, parseAbi, toHex } from "viem";
import { authorized, BUY, ethUsd, FACTORY, getLogs, LAUNCHED, rh, sendJson, TRANSFER, USDG } from "./_lib.js";

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
  try {
    if (priceCache && Date.now() - priceCache.at < PRICE_MS) return sendJson(res, 200, priceCache.body);
    const body = await gasNow();
    priceCache = { at: Date.now(), body };
    return sendJson(res, 200, body);
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}
