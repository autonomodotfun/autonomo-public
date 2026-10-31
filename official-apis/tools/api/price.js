// GET /v1/price/<token address>  (header: x-api-key)
// Live price of any Robinhood Chain launchpad token, from the latest trade on its bonding curve.
// USDG is always $1 and WETH tracks ETH; other tokens must come from the launchpad.

import { isAddress } from "viem";
import { AUTONOMO, authorized, erc20, ethUsd, EXPLORER, findLaunch, launchPrice, rh, sendJson, tokenMeta, USDG, WETH } from "./_lib.js";

const cache = new Map();

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  // "autonomo" is accepted as a name, so the original /v1/price/autonomo path keeps working.
  const raw = String(req.query.token ?? "").trim().toLowerCase();
  const token = raw === "autonomo" || raw === "$autonomo" ? AUTONOMO : raw;
  if (!isAddress(token)) return sendJson(res, 400, { error: "bad_token", message: "Pass a token contract address: /v1/price/0x…" });

  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < 15_000) return sendJson(res, hit.status, hit.body);
  try {
    const result = await price(token);
    cache.set(token, { at: Date.now(), ...result });
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
    return { status: 404, body: { error: "not_found", message: "This token wasn't launched on the Robinhood Chain launchpad in the last ~13 days, so there's no curve price." } };
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
