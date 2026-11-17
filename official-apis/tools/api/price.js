// GET /v1/price/<token address>  (header: x-api-key)
// Live price of any Robinhood Chain launchpad token, from the latest trade on its bonding curve.
// USDG is always $1 and WETH tracks ETH; other tokens must come from the launchpad.
//
// ?chain=base prices a Base token from its deepest pool on DexScreener, with its market cap and what the pool holds
// in ETH or USDC; USDC is $1 and WETH tracks ETH. Left out, the chain is Robinhood Chain, or Base when the token
// isn't a Robinhood Chain launchpad token but is a token on Base (_lib.js checkOnChain).

import { isAddress } from "viem";
import {
  AUTONOMO, authorized, badChain, chainNotReady, chainReady, chainRequest, CHAINS, checkOnChain, erc20, ethUsd, EXPLORER, findLaunch,
  findsOldLaunches, launchPrice, rh, sendJson, tokenMeta, USDG, WETH,
} from "./_lib.js";
import { dexPools } from "./_riskbase.js";

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

const cache = new Map();

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  // "autonomo" is accepted as a name, so the original /v1/price/autonomo path keeps working.
  const raw = String(req.query.token ?? "").trim().toLowerCase();
  const token = raw === "autonomo" || raw === "$autonomo" ? AUTONOMO : raw;
  if (!isAddress(token)) return sendJson(res, 400, { error: "bad_token", message: "Pass a token contract address: /v1/price/0x…" });

  const asked = chainRequest(req.query);
  if (!asked) return sendJson(res, 400, badChain);
  if (!chainReady(asked.chain)) return sendJson(res, 503, chainNotReady);
  // $AUTONOMO lives on Robinhood Chain; asked for by name, it's always looked up there.
  const key = asked.key(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return sendJson(res, hit.status, hit.body);
  try {
    const result = await checkOnChain(asked, token, { robinhood: price, base: basePrice });
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), ...result });
    return sendJson(res, result.status, result.body);
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}

async function price(token) {
  const [meta, eth] = await Promise.all([tokenMeta(token), ethUsd()]);
  if (token === USDG || token === WETH) {
    const usd = token === USDG ? 1 : eth;
    return { status: 200, body: { token, ...meta, priceUsd: usd, priceEth: usd / eth, source: token === USDG ? "USDG is a dollar stablecoin" : "Wrapped ETH, priced by Chainlink ETH/USD", updatedAt: new Date().toISOString() } };
  }
  const latest = await rh.getBlockNumber();
  const launch = await findLaunch(token, latest);
  if (!launch) {
    return { status: 404, body: { error: "not_found", message: findsOldLaunches() ? "This token wasn't launched on the Robinhood Chain launchpad, so there's no curve price." : "This token wasn't launched on the Robinhood Chain launchpad in the last ~13 days, so there's no curve price." } };
  }
  const [last, supply] = await Promise.all([
    launchPrice(token, launch, latest),
    rh.readContract({ address: token, abi: erc20, functionName: "totalSupply" }),
  ]);
  if (!last || last.priceEth === null) return { status: 404, body: { error: "no_trades", message: "No trades on this token's curve yet." } };
  const priceEth = last.priceEth * 10 ** (meta.decimals - 18);
  const priceUsd = priceEth * eth;
  return {
    status: 200,
    body: {
      token,
      name: meta.name,
      symbol: meta.symbol,
      chain: "Robinhood Chain",
      priceUsd,
      priceEth,
      marketCapUsd: (priceUsd * Number(supply)) / 10 ** meta.decimals,
      ethUsd: eth,
      lastTrade: { side: last.side, time: last.time, tx: last.tx },
      explorer: `${EXPLORER}/token/${token}`,
      venue: last.venue,
      source:
        last.venue === "curve"
          ? "Latest trade on the token's launchpad bonding curve (Robinhood Chain); ETH/USD from Chainlink on Base."
          : "Latest swap in the token's launchpad Uniswap v4 pool, after graduating from its curve (Robinhood Chain); ETH/USD from Chainlink on Base.",
      updatedAt: new Date().toISOString(),
    },
  };
}

/** A Base token's price from its deepest DexScreener pool; USDC and WETH from their pegs. */
async function basePrice(token) {
  const chain = CHAINS.base;
  const [meta, eth, supply] = await Promise.all([
    tokenMeta(token, chain),
    ethUsd(),
    chain.client.readContract({ address: token, abi: erc20, functionName: "totalSupply" }).catch(() => null),
  ]);
  if (meta.symbol === null || supply === null) return { status: 404, body: { error: "not_found", message: "No token found at this address on Base." } };
  if (token === USDC_BASE || token === WETH_BASE) {
    const usd = token === USDC_BASE ? 1 : eth;
    return { status: 200, body: { token, ...meta, chain: "Base", priceUsd: usd, priceEth: usd / eth, source: token === USDC_BASE ? "USDC is a dollar stablecoin" : "Wrapped ETH, priced by Chainlink ETH/USD", updatedAt: new Date().toISOString() } };
  }
  const pools = await dexPools(token, eth);
  const main = pools?.find((p) => p.priceUsd != null) ?? null;
  if (!main) {
    return { status: 404, body: { error: "no_trades", message: pools === null ? "DexScreener didn't answer just now. Try again." : "No pool with a price for this token on Base yet." } };
  }
  return {
    status: 200,
    body: {
      token,
      name: meta.name,
      symbol: meta.symbol,
      chain: "Base",
      priceUsd: main.priceUsd,
      priceEth: main.priceUsd / eth,
      marketCapUsd: main.marketCapUsd ?? (main.priceUsd * Number(supply)) / 10 ** meta.decimals,
      ethUsd: eth,
      pool: { dex: main.dex, pair: main.pair, quote: main.quoteSymbol, liquidityUsd: main.liquidityUsd, exitUsd: main.exitUsd, createdAt: main.createdAt, url: main.url },
      trades24h: { buys: main.buys24h, sells: main.sells24h, volumeUsd: main.volume24hUsd },
      // A pool with little ETH or USDC in it can show a price nobody could sell at.
      thinPool: main.exitUsd != null ? main.exitUsd < 1_000 : null,
      explorer: `${chain.explorer}/token/${token}`,
      venue: "dexscreener",
      source: "The token's deepest pool on Base, as DexScreener reports it; ETH/USD from Chainlink on Base.",
      updatedAt: new Date().toISOString(),
    },
  };
}
