// The Risk Checker on Base (risk.js, with chain=base or for a token that's only on Base).
//
// Robinhood Chain's check replays every transfer and reads the launchpad's bonding curve. Base has no such curve
// and its big tokens have millions of transfers, so here:
// - Where the token came from: its first mint, and the Clanker or Zora launch event in that transaction (_lib.js).
// - Holders: every transfer since the mint, added up, when there are at most MAX_TRANSFERS of them (new launches,
//   the tokens people check most). Bigger tokens use the top holders Base's Blockscout lists, and say so.
// - Pools and launch contracts are set apart from holders: the Uniswap v4 PoolManager, the token's pools that
//   DexScreener lists, contracts that answer token0/token1 with the token, and launch contracts: whatever the launch
//   transaction handed supply to (Clanker's vaults, lockers and airdrops), or a Clanker-style verified name. What's
//   left is the circulating supply shares are taken of.
// - Market: price, market cap and 24 hour trades of the token's deepest pool, from DexScreener. Liquidity is judged
//   by the ETH or USDC side of that pool, since that's what a seller can get out; the token's own side isn't.
// The flags and score use the same thresholds as Robinhood Chain, plus one for thin liquidity.

import { blockscout, CHAINS, contractName, erc20, ethUsd, isPoolOf, logsCapped, baseOrigin, tokenMeta, TRANSFER, transferRow } from "./_lib.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const MAX_TRANSFERS = 40_000; // beyond this, holders come from Blockscout's list instead of the token's whole history
const REPLAY_MS = 9_000; // a history that takes longer than this to read is treated as too big, so answers stay in time
const CLASSIFIED = 40; // biggest balances checked for being a pool or a launch contract
const DAY_S = 86_400;
const LAUNCH_NAME = /lock|vault|airdrop|clanker|bonding|vesting|curve|launch|zora/i;

const pct = (part, whole) => (whole > 0n ? Number((part * 1_000_000n) / whole) / 10_000 : 0);
const low = (a) => String(a ?? "").toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(a);

/** The token's pools on DexScreener, deepest first, with what each can pay out. Null when DexScreener can't answer. */
export async function dexPools(token, ethPrice) {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${token}`, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const pairs = await res.json();
    if (!Array.isArray(pairs)) return null;
    return pairs
      .filter((p) => low(p.baseToken?.address) === token)
      .map((p) => {
        const quote = low(p.quoteToken?.address);
        const quoteAmount = Number(p.liquidity?.quote ?? NaN);
        // What sits on the other side of the pool, in dollars: only for ETH and USDC, which have a known price.
        const exitUsd = !Number.isFinite(quoteAmount) ? null : quote === WETH ? quoteAmount * ethPrice : quote === USDC ? quoteAmount : null;
        return {
          dex: `${p.dexId ?? "dex"}${p.labels?.length ? ` ${p.labels.join(" ")}` : ""}`,
          pair: low(p.pairAddress),
          quoteSymbol: p.quoteToken?.symbol ?? null,
          priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
          marketCapUsd: p.marketCap ?? p.fdv ?? null,
          liquidityUsd: p.liquidity?.usd ?? null,
          exitUsd,
          buys24h: p.txns?.h24?.buys ?? null,
          sells24h: p.txns?.h24?.sells ?? null,
          volume24hUsd: p.volume?.h24 ?? null,
          createdAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
          url: p.url ?? null,
        };
      })
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  } catch {
    return null;
  }
}

/** What a big holder is when it isn't a person: "pool", "launch" (a launchpad contract), or null. */
async function kindOf(address, token, known, client) {
  if (known.pools.has(address)) return "pool";
  if (known.launch.has(address)) return "launch";
  if (known.people.has(address)) return null;
  if (known.unnamed.has(address)) return (await isPoolOf(address, token, client)) ? "pool" : null;
  const code = await client.getCode({ address }).catch(() => undefined);
  if (!code || code === "0x") return null;
  // Launch contracts got their supply in the launch transaction itself (vaults, lockers, airdrops).
  if (known.launchRecipients.has(address)) return (await isPoolOf(address, token, client)) ? "pool" : "launch";
  // Blockscout can take seconds to name a contract; past 3 s it counts as unnamed.
  const name = await Promise.race([contractName(address, CHAINS.base), new Promise((r) => setTimeout(() => r(null), 3_000))]);
  if (/pool|pair/i.test(name ?? "") || (await isPoolOf(address, token, client))) return "pool";
  if (LAUNCH_NAME.test(name ?? "")) return "launch";
  return null;
}

export async function checkBaseRisk(token) {
  const chain = CHAINS.base;
  const client = chain.client;
  const [meta, supply, origin, ethPrice, counters] = await Promise.all([
    tokenMeta(token, chain),
    client.readContract({ address: token, abi: erc20, functionName: "totalSupply" }).catch(() => null),
    baseOrigin(token).catch(() => null),
    ethUsd(),
    // Blockscout knows big tokens' transfer counts (new ones it hasn't indexed answer 404, and get read in full).
    blockscout(`/api/v2/tokens/${token}/counters`, {}, CHAINS.base).catch(() => null),
  ]);
  if (!supply || meta.symbol === null || !origin) {
    return { status: 404, body: { error: "not_found", message: "No token found at this address on Base." } };
  }
  // A big token's holders come from Blockscout, whose list can take several seconds: asked for now, while the rest is read.
  const big = Number(counters?.transfers_count ?? 0) > MAX_TRANSFERS;
  const listed = big ? blockscout(`/api/v2/tokens/${token}/holders`, {}, chain).catch(() => null) : null;
  const creator = origin.launch?.creator ?? origin.sender;
  const pools = (await dexPools(token, ethPrice)) ?? [];
  const main = pools[0] ?? null;

  // Addresses that aren't holders: burns, pools, and the contracts the launch handed supply to.
  const known = {
    pools: new Set([chain.poolManager, ...pools.map((p) => p.pair).filter(isAddr)]),
    launch: new Set([origin.mintedTo, origin.launch?.factory].filter(Boolean)),
    people: new Set(), // checked already: not a pool or a launch contract
    unnamed: new Set(), // contracts Blockscout has no name for: only the pool check is left
    launchRecipients: new Set(), // who the launch transaction handed supply to
  };

  // ---- Holders and trades: the whole history when it's small enough, Blockscout's top holders otherwise.
  let transfers = null;
  if (!big) {
    try {
      const logs = await logsCapped({ address: token, topics: [TRANSFER] }, origin.block, origin.latest, chain, MAX_TRANSFERS, { logs: 0, deadline: Date.now() + REPLAY_MS });
      transfers = logs.map(transferRow);
    } catch (e) {
      if (!e.tooMany) throw e;
    }
  }

  for (const t of transfers ?? []) if (t.hash === origin.tx && t.to !== creator) known.launchRecipients.add(t.to);

  let balances; // address -> raw balance, for the addresses we know
  let holderCount = null;
  if (transfers) {
    balances = new Map();
    for (const t of transfers) {
      const v = BigInt(t.value);
      if (t.from !== ZERO) balances.set(t.from, (balances.get(t.from) ?? 0n) - v);
      balances.set(t.to, (balances.get(t.to) ?? 0n) + v);
    }
  } else {
    const page = await (listed ?? blockscout(`/api/v2/tokens/${token}/holders`, {}, chain).catch(() => null));
    if (!page?.items?.length) {
      return { status: 503, body: { error: "too_busy", message: "This token has too many transfers to read in time, and Base's Blockscout doesn't list its holders yet. Nobody is charged." } };
    }
    balances = new Map(page.items.map((h) => [low(h.address.hash), BigInt(h.value)]));
    holderCount = Number(counters?.token_holders_count ?? 0) || null;
    // Blockscout already says which holders are contracts and their names, so only unnamed contracts get a pool check.
    for (const h of page.items) {
      const a = low(h.address.hash);
      const n = h.address.name ?? "";
      if (!h.address.is_contract) known.people.add(a);
      else if (/pool|pair/i.test(n)) known.pools.add(a);
      else if (LAUNCH_NAME.test(n)) known.launch.add(a);
      else if (n) known.people.add(a);
      else known.unnamed.add(a);
    }
  }

  // The biggest balances get checked for being a pool or a launch contract.
  const biggest = [...balances].filter(([a, b]) => b > 0n && a !== ZERO && a !== DEAD).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
  const kinds = new Map(await Promise.all(biggest.slice(0, CLASSIFIED).map(async ([a]) => [a, await kindOf(a, token, known, client)])));
  for (const [a, k] of kinds) if (k === "pool") known.pools.add(a); else if (k === "launch") known.launch.add(a);
  const infra = (a) => a === ZERO || a === DEAD || known.pools.has(a) || known.launch.has(a);

  const sum = (pred) => [...balances].reduce((s, [a, b]) => (b > 0n && pred(a) ? s + b : s), 0n);
  const inPool = sum((a) => known.pools.has(a));
  const locked = sum((a) => known.launch.has(a));
  const deadHeld = balances.get(DEAD) ?? 0n;
  const zeroBurned = transfers ? balances.get(ZERO) ?? 0n : 0n;
  const circulating = supply - inPool - locked - deadHeld;
  const holders = biggest.filter(([a]) => !infra(a));
  if (transfers) holderCount = holders.length;
  const top10 = holders.slice(0, 10).reduce((s, [, b]) => s + b, 0n);
  const creatorHolds = balances.get(creator) ?? (await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [creator] }).catch(() => 0n));

  // ---- Trades, from the transfers (whole history only): tokens out of a pool are buys, into one are sells.
  let trading = null;
  const launchBlockBuyers = new Set();
  let creatorBought = 0n, creatorSold = 0n, bundleHolds = 0n;
  const buyers = new Set();
  if (transfers) {
    const now = Math.floor(Date.now() / 1000);
    let buys = 0, sells = 0, buys24h = 0, sells24h = 0;
    for (const t of transfers) {
      const recent = now - Number(t.timeStamp) <= DAY_S;
      if (known.pools.has(t.from) && !infra(t.to)) {
        buys++; if (recent) buys24h++;
        buyers.add(t.to);
        if (BigInt(t.blockNumber) === origin.block) launchBlockBuyers.add(t.to);
        if (t.to === creator) creatorBought += BigInt(t.value);
      } else if (known.pools.has(t.to) && !infra(t.from)) {
        sells++; if (recent) sells24h++;
        if (t.from === creator) creatorSold += BigInt(t.value);
      }
    }
    bundleHolds = [...launchBlockBuyers].reduce((s, a) => s + (balances.get(a) ?? 0n), 0n);
    trading = { buys, sells, buys24h, sells24h, uniqueBuyers: buyers.size, stillHolding: holders.length };
  }

  // ---- Flags and score: the same thresholds as on Robinhood Chain, shares of circulating supply.
  const flags = [];
  let score = 0;
  const flag = (points, text) => { score += points; flags.push({ severity: points >= 3 ? "high" : points >= 2 ? "medium" : "low", text }); };
  const largest = holders[0] ? pct(holders[0][1], circulating) : 0;
  const top10Share = pct(top10, circulating);
  const creatorShare = pct(creatorHolds, supply);
  const bundleShare = pct(bundleHolds, circulating);

  if (largest >= 30) flag(3, `One wallet holds ${largest.toFixed(1)}% of circulating supply`);
  else if (largest >= 15) flag(2, `The largest wallet holds ${largest.toFixed(1)}% of circulating supply`);
  if (top10Share >= 70) flag(3, `Top 10 wallets hold ${top10Share.toFixed(1)}% of circulating supply`);
  else if (top10Share >= 45) flag(2, `Top 10 wallets hold ${top10Share.toFixed(1)}% of circulating supply`);
  if (creatorShare >= 10) flag(3, `The creator still holds ${creatorShare.toFixed(1)}% of total supply`);
  else if (creatorShare >= 3) flag(1, `The creator holds ${creatorShare.toFixed(1)}% of total supply`);
  if (creatorSold > 0n && creatorBought > 0n && creatorSold * 2n >= creatorBought) flag(2, "The creator has sold at least half of what they bought");
  if (launchBlockBuyers.size > 0 && bundleShare >= 25) flag(3, `Wallets that bought in the launch block still hold ${bundleShare.toFixed(1)}% of circulating supply`);
  else if (launchBlockBuyers.size >= 3) flag(1, `${launchBlockBuyers.size} wallets bought in the launch block`);
  if (trading) {
    if (holders.length === 0) flag(2, "No wallet holds this token outside its pools and launch contracts");
    else if (holders.length < 20) flag(2, `Only ${holders.length} holders so far`);
    if (buyers.size >= 10 && holders.length < buyers.size * 0.25) {
      flag(2, `Most buyers already sold: ${holders.length} of ${buyers.size} still hold (often a sign of bot volume)`);
    }
    if (trading.sells24h > trading.buys24h * 1.5 && trading.sells24h >= 10) flag(1, "More sells than buys in the last 24 hours");
  }
  // Only on Base: what a seller could get out of the deepest pool.
  if (main?.exitUsd != null) {
    if (main.exitUsd < 1_000) flag(3, `Its main pool holds only $${main.exitUsd.toFixed(0)} in ${main.quoteSymbol} to sell into`);
    else if (main.exitUsd < 10_000) flag(1, `Its main pool holds $${Math.round(main.exitUsd).toLocaleString("en-US")} in ${main.quoteSymbol} to sell into`);
  } else if (!pools.length && inPool === 0n) flag(2, "No trading pool found for this token");
  if (!flags.length) flags.push({ severity: "info", text: "No major red flags in holder or trading data" });
  const level = score >= 6 ? "high" : score >= 3 ? "medium" : "low";

  const unit = 10 ** meta.decimals;
  return {
    status: 200,
    body: {
      token,
      name: meta.name,
      symbol: meta.symbol,
      chain: "Base",
      risk: { level, score, flags },
      launch: {
        launchedAt: origin.time ? new Date(origin.time * 1000).toISOString() : null,
        creator,
        launchpad: origin.launch?.launchpad ?? null,
        curve: null,
        launchTx: origin.tx,
      },
      holders: {
        count: holderCount,
        from: transfers ? "every transfer since the mint" : "the top holders Base's Blockscout lists",
        largestPercent: largest,
        top10Percent: top10Share,
        top: holders.slice(0, 5).map(([address, b]) => ({ address, percent: pct(b, circulating), tokens: Number(b) / unit })),
      },
      supply: {
        total: Number(supply) / unit,
        inCurvePercent: null,
        inPoolPercent: pct(inPool, supply),
        burnedPercent: pct(deadHeld + zeroBurned, supply + zeroBurned),
        lockedPercent: pct(locked, supply),
        lockedNote: locked > 0n ? "Held by launchpad contracts, such as Clanker's vaults, lockers and airdrops. Some of it is released later: a vault vests to the creator and an airdrop pays out to its list." : null,
        creatorPercent: creatorShare,
        launchBlockBuyers: transfers ? launchBlockBuyers.size : null,
        launchBlockBuyersPercent: transfers ? bundleShare : null,
      },
      trading: {
        ...(trading ?? { buys: null, sells: null, buys24h: main?.buys24h ?? null, sells24h: main?.sells24h ?? null, uniqueBuyers: null, stillHolding: null }),
        volume24hUsd: main?.volume24hUsd ?? null,
        volumeEth: null,
        curve: null,
        pool: main && { dex: main.dex, pair: main.pair, quote: main.quoteSymbol, liquidityUsd: main.liquidityUsd, exitUsd: main.exitUsd, url: main.url },
      },
      market: {
        priceEth: main?.priceUsd != null && ethPrice ? main.priceUsd / ethPrice : null,
        priceUsd: main?.priceUsd ?? null,
        priceSource: main ? "dexscreener" : null,
        graduated: null,
        marketCapUsd: main?.marketCapUsd ?? null,
        curveProgress: null,
      },
      explorer: `${chain.explorer}/token/${token}`,
      note: "Heuristic from public on-chain data, not financial advice. A low score does not make a token safe. On Base, prices and pools come from DexScreener.",
      updatedAt: new Date().toISOString(),
    },
  };
}
