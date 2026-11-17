// GET /v1/portfolio/<wallet address>?days=2  (header: x-api-key)
// What a wallet holds on Robinhood Chain, in USD: ETH, USDG, $AUTONOMO and every token it received in the last
// `days` days (1–7, default 2), with current balances and launchpad curve prices. Tokens that copy a known
// symbol (a fake "USDG" airdrop, say) are flagged as likely impostors.
//
// With a Blockscout key, the wallet's tokens come from Blockscout's list of everything it holds, however long ago
// it got them. Without one, or if Blockscout doesn't answer, they are discovered from incoming transfers in the last
// `days` days. ETH, USDG, WETH and $AUTONOMO are always checked directly, so core balances never go missing.
// Balances are always read from the chain; Blockscout only says which tokens to look at.
//
// ?chain=base shows what the wallet holds on Base: ETH, USDC, WETH and every token Alchemy lists for it (through
// BASE_RPC_URL), priced from DexScreener's deepest pool for each. Left out, the chain is Robinhood Chain, or Base when
// the wallet holds nothing on Robinhood Chain but does hold something on Base.

import { isAddress, pad, toHex } from "viem";
import {
  AUTONOMO, authorized, badChain, blockscout, BLOCKS_PER_DAY, chainNotReady, chainReady, chainRequest, CHAINS, erc20, hasBlockscout, ethUsd,
  EXPLORER, findLaunch, getLogs, launchPrice, rh, sendJson, tokenMeta, TRANSFER, USDG, WETH,
} from "./_lib.js";

const SPAN = 29_000n; // log queries without an address filter may span 30,000 blocks
const PARALLEL = 24;
const DISCOVERY_BUDGET_MS = 7_000; // stay well inside the gateway's 25 s
const MAX_TOKENS = 30;
const cache = new Map();
// Symbols scammers like to copy, and the real contracts.
const GENUINE = { USDG, WETH, AUTONOMO, ETH: "eth-native" };
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const GENUINE_BASE = { USDC: USDC_BASE, WETH: WETH_BASE, ETH: "eth-native" };
const MIN_LIQUIDITY_USD = 1_000; // a Base price only counts from a pool at least this deep
const BASE_LISTED = 150; // tokens Alchemy lists that get priced; spam airdrops can run into the hundreds
const PICKED = "This wallet holds nothing on Robinhood Chain, so this is what it holds on Base. Pass chain=robinhood to look on Robinhood Chain only.";

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const wallet = String(req.query.wallet ?? "").trim().toLowerCase();
  if (!isAddress(wallet)) return sendJson(res, 400, { error: "bad_wallet", message: "Pass a wallet address: /v1/portfolio/0x…" });
  const n = Number(req.query.days ?? 2);
  const days = Number.isInteger(n) && n >= 1 ? Math.min(n, 7) : 2;

  const asked = chainRequest(req.query);
  if (!asked) return sendJson(res, 400, badChain);
  if (!chainReady(asked.chain)) return sendJson(res, 503, chainNotReady);

  const key = `${asked.key(wallet)}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return sendJson(res, 200, hit.body);
  try {
    let body = asked.chain === CHAINS.base ? await basePortfolio(wallet) : await portfolio(wallet, days);
    // Chain left out and nothing on Robinhood Chain: what the wallet holds on Base, if anything.
    if (asked.fallback && body.totalUsd === 0 && body.tokens.length === 0 && chainReady(CHAINS.base)) {
      const onBase = await basePortfolio(wallet).catch(() => null);
      if (onBase && (onBase.eth.amount > 0 || onBase.tokens.length > 0)) {
        const { chain, ...rest } = onBase;
        body = { chain, chainNote: PICKED, ...rest };
      }
    }
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 2000) cache.clear();
    return sendJson(res, 200, body);
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}

/** Tokens that sent this wallet anything in the last `days` days. */
async function receivedTokens(wallet, latest, days) {
  const from = latest - BLOCKS_PER_DAY * BigInt(days);
  const windows = [];
  for (let hi = latest; hi > from; hi -= SPAN + 1n) windows.push([hi - SPAN > from ? hi - SPAN : from, hi]);
  const found = new Set();
  const started = Date.now();
  let scanned = 0;
  for (let i = 0; i < windows.length; i += PARALLEL) {
    if (Date.now() - started > DISCOVERY_BUDGET_MS) break;
    const batch = await Promise.all(
      windows.slice(i, i + PARALLEL).map(([lo, hi]) =>
        getLogs({ topics: [TRANSFER, null, pad(wallet)], fromBlock: toHex(lo), toBlock: toHex(hi) }).catch(() => []),
      ),
    );
    for (const logs of batch) for (const l of logs) if (l.topics.length === 3) found.add(l.address.toLowerCase());
    scanned = Math.min(windows.length, i + PARALLEL);
  }
  return { tokens: [...found], complete: scanned >= windows.length };
}

/** Every ERC-20 the wallet holds, as Blockscout lists them, with a market price where it has one. Null on failure. */
async function heldTokens(wallet) {
  if (!hasBlockscout()) return null;
  try {
    const list = await blockscout(`/api/v2/addresses/${wallet}/token-balances`);
    if (!Array.isArray(list)) return null;
    const market = new Map();
    for (const row of list) {
      const address = String(row.token?.address_hash ?? row.token?.address ?? "").toLowerCase();
      if (row.token?.type !== "ERC-20" || !isAddress(address) || BigInt(row.value || 0) === 0n) continue;
      const rate = Number(row.token.exchange_rate);
      market.set(address, { priceUsd: rate > 0 ? rate : null, holders: Number(row.token.holders_count) || 0 });
    }
    // Scam airdrops reach many wallets but trade nowhere; priced tokens and widely held ones go first.
    const tokens = [...market].sort((a, b) => (b[1].priceUsd ? 1 : 0) - (a[1].priceUsd ? 1 : 0) || b[1].holders - a[1].holders).map(([a]) => a);
    return { tokens, market };
  } catch {
    return null;
  }
}

async function portfolio(wallet, days) {
  const latest = await rh.getBlockNumber();
  const [ethBalance, eth, indexed] = await Promise.all([rh.getBalance({ address: wallet }), ethUsd(), heldTokens(wallet)]);
  const received = indexed ? { tokens: indexed.tokens, complete: true } : await receivedTokens(wallet, latest, days);
  const candidates = [...new Set([USDG, WETH, AUTONOMO, ...received.tokens])].slice(0, 200);

  // Current balances; keep the non-zero ones.
  const balances = await Promise.all(
    candidates.map(async (token) => ({ token, raw: await rh.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [wallet] }).catch(() => 0n) })),
  );
  const held = balances.filter((b) => b.raw > 0n).slice(0, MAX_TOKENS);

  const holdings = await Promise.all(
    held.map(async ({ token, raw }) => {
      const meta = await tokenMeta(token);
      const amount = Number(raw) / 10 ** meta.decimals;
      let priceUsd = null;
      let source = null;
      if (token === USDG) [priceUsd, source] = [1, "stablecoin"];
      else if (token === WETH) [priceUsd, source] = [eth, "ETH"];
      else {
        // Each lookup gets at most 6 s, so one slow token can't hold up the whole answer.
        const lookup = (async () => {
          // Only recent launches: a wallet can hold many tokens, and each older search costs more requests.
          const launch = await findLaunch(token, latest, { recentOnly: true }).catch(() => null);
          return launch ? await launchPrice(token, launch, latest).catch(() => null) : null;
        })();
        const last = await Promise.race([lookup, new Promise((r) => setTimeout(() => r(null), 6_000))]);
        if (last?.priceEth != null) {
          [priceUsd, source] = [last.priceEth * 10 ** (meta.decimals - 18) * eth, last.venue === "curve" ? "launchpad curve" : "launchpad Uniswap v4 pool"];
        } else if (indexed?.market.get(token)?.priceUsd) {
          // Not a recent launch: fall back to the market price Blockscout shows for the token.
          [priceUsd, source] = [indexed.market.get(token).priceUsd, "market price shown by Blockscout"];
        }
      }
      const copies = Object.entries(GENUINE).find(([s, a]) => meta.symbol?.toUpperCase().replace(/^\$/, "") === s && a !== token);
      const warning = copies ? `Not the real ${copies[0]}: likely an impostor or scam airdrop. Don't interact with it.` : null;
      return { token, symbol: meta.symbol, name: meta.name, amount, priceUsd, valueUsd: priceUsd === null ? null : amount * priceUsd, priceSource: source, warning };
    }),
  );
  holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  const ethAmount = Number(ethBalance) / 1e18;
  const tokensUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  return {
    wallet,
    chain: "Robinhood Chain",
    totalUsd: ethAmount * eth + tokensUsd,
    eth: { amount: ethAmount, valueUsd: ethAmount * eth },
    tokens: holdings,
    unpriced: holdings.filter((h) => h.priceUsd === null).length,
    warnings: holdings.filter((h) => h.warning).length,
    coverage: indexed
      ? `Every token the wallet holds, as listed by Blockscout${held.length < balances.filter((b) => b.raw > 0n).length ? ` (the first ${MAX_TOKENS} shown)` : ""}.`
      : `ETH, USDG, WETH and $AUTONOMO always; other tokens received in the last ${days} days${received.complete ? "" : " (partly scanned: the chain was slow)"}.`,
    ethUsd: eth,
    explorer: `${EXPLORER}/address/${wallet}`,
    updatedAt: new Date().toISOString(),
  };
}

/** Every ERC-20 Alchemy lists for a wallet on Base with a balance, up to BASE_LISTED. Null when the RPC can't list. */
async function baseListed(wallet) {
  const client = CHAINS.base.client;
  const found = [];
  let pageKey;
  try {
    do {
      const r = await client.request({ method: "alchemy_getTokenBalances", params: [wallet, "erc20", ...(pageKey ? [{ pageKey }] : [])] });
      for (const b of r?.tokenBalances ?? []) {
        const raw = BigInt(b.tokenBalance && b.tokenBalance !== "0x" ? b.tokenBalance : 0);
        if (raw > 0n) found.push({ token: b.contractAddress.toLowerCase(), raw });
      }
      pageKey = r?.pageKey;
    } while (pageKey && found.length < BASE_LISTED);
    return found.slice(0, BASE_LISTED);
  } catch {
    return null;
  }
}

/** USD prices on Base from DexScreener: each token's deepest pool, 30 tokens a request. Tokens with no pool, or only
 * pools under MIN_LIQUIDITY_USD, are left out: a scam token's price on a near-empty pool would inflate the total. */
async function dexPrices(tokens) {
  const prices = new Map();
  const batches = [];
  for (let i = 0; i < tokens.length; i += 30) batches.push(tokens.slice(i, i + 30));
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${batch.join(",")}`, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
        if (!res.ok) return;
        for (const p of await res.json()) {
          const t = String(p.baseToken?.address ?? "").toLowerCase();
          const price = Number(p.priceUsd);
          const liquidity = Number(p.liquidity?.usd ?? 0);
          if (!(price > 0) || liquidity < MIN_LIQUIDITY_USD || (prices.get(t)?.liquidity ?? -1) >= liquidity) continue;
          prices.set(t, { priceUsd: price, liquidity, dex: p.dexId ?? "dex" });
        }
      } catch {
        // a slow batch just leaves its tokens unpriced
      }
    }),
  );
  return prices;
}

/** What a wallet holds on Base, the same shape as on Robinhood Chain. */
async function basePortfolio(wallet) {
  const chain = CHAINS.base;
  const client = chain.client;
  const [ethBalance, eth, listed] = await Promise.all([client.getBalance({ address: wallet }), ethUsd(), baseListed(wallet)]);
  // USDC and WETH are always read, so they never go missing even if the list fails.
  const core = await Promise.all(
    [USDC_BASE, WETH_BASE].map(async (token) => ({ token, raw: await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [wallet] }).catch(() => 0n) })),
  );
  const all = new Map([...(listed ?? []), ...core].filter((b) => b.raw > 0n).map((b) => [b.token, b.raw]));
  const others = [...all.keys()].filter((t) => t !== USDC_BASE && t !== WETH_BASE);
  const prices = await dexPrices(others);

  const holdings = await Promise.all(
    [...all].map(async ([token, raw]) => {
      const meta = await tokenMeta(token, chain);
      const amount = Number(raw) / 10 ** meta.decimals;
      let priceUsd = null;
      let source = null;
      if (token === USDC_BASE) [priceUsd, source] = [1, "stablecoin"];
      else if (token === WETH_BASE) [priceUsd, source] = [eth, "ETH"];
      else if (prices.has(token)) [priceUsd, source] = [prices.get(token).priceUsd, `DexScreener (${prices.get(token).dex})`];
      const copies = Object.entries(GENUINE_BASE).find(([sym, a]) => meta.symbol?.toUpperCase().replace(/^\$/, "") === sym && a !== token);
      const warning = copies ? `Not the real ${copies[0]}: likely an impostor or scam airdrop. Don't interact with it.` : null;
      return { token, symbol: meta.symbol, name: meta.name, amount, priceUsd, valueUsd: priceUsd === null ? null : amount * priceUsd, priceSource: source, warning };
    }),
  );
  // Priced holdings first, by value; a long tail of unpriced airdrops is cut to MAX_TOKENS.
  holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  const shown = holdings.slice(0, MAX_TOKENS);

  const ethAmount = Number(ethBalance) / 1e18;
  const tokensUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  return {
    wallet,
    chain: "Base",
    totalUsd: ethAmount * eth + tokensUsd,
    eth: { amount: ethAmount, valueUsd: ethAmount * eth },
    tokens: shown,
    unpriced: holdings.filter((h) => h.priceUsd === null).length,
    warnings: holdings.filter((h) => h.warning).length,
    coverage: listed
      ? `Every token the wallet holds on Base, as Alchemy lists them${holdings.length > shown.length ? ` (${holdings.length} in all: the ${MAX_TOKENS} most valuable shown)` : ""}${listed.length >= BASE_LISTED ? ` (the first ${BASE_LISTED} it listed were priced)` : ""}. Prices from DexScreener; a token with no pool there of at least $1,000 is unpriced.`
      : "ETH, USDC and WETH only: Alchemy didn't list the wallet's other tokens just now.",
    ethUsd: eth,
    explorer: `${chain.explorer}/address/${wallet}`,
    updatedAt: new Date().toISOString(),
  };
}
