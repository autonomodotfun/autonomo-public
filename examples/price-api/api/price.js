// $AUTONOMO price API: the example API for the Autonomo launch tutorial.
//
// GET /v1/price/autonomo  (header: x-api-key: <PRICE_API_KEY>)
//
// $AUTONOMO trades on its launchpad bonding curve on Robinhood Chain, not on a DEX pool yet, so "price" here
// means the price of the latest real trade on that curve (ETH paid or received / tokens). USD uses Chainlink's
// ETH/USD feed on Base. Everything is read straight from public chains, so every number can be checked.

import { timingSafeEqual } from "node:crypto";
import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { base } from "viem/chains";

const TOKEN = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const CURVE = "0x28b4BB34f4d84552a0f4AAc4355dA9C3fa929d65"; // $AUTONOMO's bonding curve
const BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455"; // data: ethIn, tokensOut, fee, fee
const SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df"; // data: tokensIn, ethOut, fee, fee
const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});
const rh = createPublicClient({ chain: robinhood, transport: http() });
const bs = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined) });
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);

let cache = null; // { at, body }
const CACHE_MS = 15_000;

function authorized(req) {
  const expected = process.env.PRICE_API_KEY;
  if (!expected) return true; // local development without a key
  const given = Buffer.from(String(req.headers["x-api-key"] ?? ""));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function latestTrade() {
  const latest = await rh.getBlockNumber();
  // Look back in growing windows until a trade shows up.
  for (const span of [50_000n, 500_000n, 4_000_000n]) {
    const logs = await rh.getLogs({ address: CURVE, fromBlock: latest > span ? latest - span : 0n, toBlock: latest });
    const trades = logs.filter((l) => l.topics[0] === BUY || l.topics[0] === SELL);
    if (trades.length) return trades.at(-1);
  }
  return null;
}

async function ethUsd() {
  const [round, decimals] = await Promise.all([
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "latestRoundData" }),
    bs.readContract({ address: CHAINLINK_ETH_USD_BASE, abi: feedAbi, functionName: "decimals" }),
  ]);
  return { price: Number(round[1]) / 10 ** decimals, updatedAt: new Date(Number(round[3]) * 1000).toISOString() };
}

async function quote() {
  const [trade, eth] = await Promise.all([latestTrade(), ethUsd()]);
  if (!trade) return { status: 404, body: { error: "no_trades", message: "No recent $AUTONOMO trades found." } };

  const words = trade.data.slice(2).match(/.{64}/g).map((w) => BigInt(`0x${w}`));
  const buy = trade.topics[0] === BUY;
  const ethWei = buy ? words[0] : words[1];
  const tokensWei = buy ? words[1] : words[0];
  const priceEth = Number(ethWei) / Number(tokensWei); // both have 18 decimals
  const block = await rh.getBlock({ blockNumber: trade.blockNumber });

  return {
    status: 200,
    body: {
      token: "AUTONOMO",
      contract: TOKEN,
      chain: "Robinhood Chain",
      priceEth,
      priceUsd: priceEth * eth.price,
      ethUsd: eth.price,
      lastTrade: {
        side: buy ? "buy" : "sell",
        tokens: Number(tokensWei) / 1e18,
        eth: Number(ethWei) / 1e18,
        tx: trade.transactionHash,
        block: Number(trade.blockNumber),
        time: new Date(Number(block.timestamp) * 1000).toISOString(),
      },
      source: "Latest trade on the $AUTONOMO bonding curve (Robinhood Chain); ETH/USD from Chainlink on Base.",
      updatedAt: new Date().toISOString(),
    },
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });

  const token = String(req.query.token ?? "").toLowerCase();
  if (token !== "autonomo" && token !== TOKEN) {
    return res.status(404).json({ error: "unknown_token", message: "This example only prices $AUTONOMO: /v1/price/autonomo" });
  }
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), result: await quote() };
    return res.status(cache.result.status).json(cache.result.body);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}
