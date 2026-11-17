// Official Autonomo API: who really holds a token, who sniped its launch, and which wallets are probably one person.
//
// GET /v1/holders/<token address>   (header: x-api-key: <TOOLS_API_KEY>)
//
// 1. Top holders, with the pool, the launch contracts and burns set apart, and unnamed contracts counted on their own.
// 2. Linked wallets: top holders whose first ETH came from the same wallet. Exchanges and other services are ignored,
//    since thousands of strangers share them.
// 3. Snipers: wallets that bought from the launch contract in the first 15 seconds, how much they took and still hold,
//    and which of them bought in the same block.
// 4. Repeat snipers: whether the biggest early buyers also bought other tokens in those tokens' first 15 seconds.
//
// Holders, trades and wallet histories come from the Blockscout PRO API (BLOCKSCOUT_KEY, roughly 60 to 110 requests a
// call); balances and wallet checks from the chain. Based on the audit method in an advisor's notes (Nov 2026).
//
// A link is always "probable", never proven. Every claim comes with the addresses and transactions behind it.
//
// ?chain=base reads Base instead. Holders come from Base's Blockscout when it has indexed the token; it misses many
// new ones, so otherwise every transfer since the mint is read from the chain and added up. Snipers are read from
// the chain too: the blocks of the first seconds, where buys come from the Uniswap v4 pool, the contract that got
// the minted supply, or whichever address sent to the most wallets.

import { isAddress } from "viem";
import {
  authorized, badChain, chainNotReady, chainReady, chainRequest, checkOnChain, baseOrigin, blockscout, blockscoutList, CHAINS, contractName, erc20, findLaunch, firstLog,
  hasBlockscout, logsBetween, rh, sendJson, tokenMeta, TRANSFER, transferRow,
} from "./_lib.js";
import { pad, parseAbi } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952"; // PonsV2LaunchLocker: no way to send tokens out
const TOP = 30; // holders looked at
const SNIPE_SECONDS = 15; // a buy this soon after the first transfer is a snipe
const EARLY_ROWS = 1000; // first transfers read when looking for snipers
const SNIPERS_LISTED = 40; // snipers whose current balance is read
const REPEAT_CHECKED = 10; // biggest early buyers checked against other launches
const REPEAT_TOKENS = 5; // other tokens looked at for each of them, newest first
const SERVICE_TXS = 5000; // a funder that has sent more than this is an exchange or a service
const REPEAT_DEADLINE_MS = 14_000; // past this, the repeat-sniper step is skipped so the answer stays in time

const CACHE_MS = 10 * 60_000;
const cache = new Map(); // token -> { at, status, body }
const firstTransferAt = new Map(); // token -> time of its first transfer, which never changes
const BASE_SNIPE_BLOCKS = 10n; // Base makes a block every 2 seconds, so 10 blocks cover the snipe window
const pairAbi = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)"]);

/** Whether a contract is a Uniswap-style pool of the token: it answers token0() and token1() and one of them is it. */
async function isPoolOf(address, token, client) {
  const [t0, t1] = await Promise.all(
    ["token0", "token1"].map((fn) => client.readContract({ address, abi: pairAbi, functionName: fn }).catch(() => null)),
  );
  return [t0, t1].some((t) => t && t.toLowerCase() === token);
}

const iso = (ts) => new Date(Number(ts) * 1000).toISOString();
const low = (a) => String(a ?? "").toLowerCase();
const positive = (t) => BigInt(t.value || 0) > 0n;

/** What a holder is, when it isn't a person: burned supply, the trading pool, or the launchpad's own contracts. */
export function infraKind(address, name, isContract, launchSource, chain = CHAINS.robinhood) {
  if (address === ZERO || address === DEAD) return "burn";
  if (address === chain.poolManager) return "pool";
  if (address === LOCKER || (launchSource && address === launchSource)) return "launch";
  if (!isContract) return null;
  const n = (name ?? "").toLowerCase();
  if (/pool|pair/.test(n)) return "pool";
  if (/lock|curve|launch/.test(n)) return "launch";
  // Base launchpads' own contracts: Clanker's vaults and lockers, Virtuals' bonding curve.
  if (chain === CHAINS.base && /bonding|vault|clanker|vesting/.test(n)) return "launch";
  return null;
}

/** The earliest ETH that reached a wallet, sent directly or from inside a contract. */
async function firstFunder(wallet, chain) {
  const [normal, internal] = await Promise.all([
    blockscoutList("txlist", { address: wallet, page: 1, offset: 20 }, chain),
    blockscoutList("txlistinternal", { address: wallet, page: 1, offset: 20 }, chain),
  ]);
  const first = [...normal.filter((t) => t.isError !== "1"), ...internal]
    .filter((t) => low(t.to) === wallet && positive(t))
    .sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp))[0];
  if (!first) return null;
  return { funder: low(first.from), eth: Number(first.value) / 1e18, time: iso(first.timeStamp), at: Number(first.timeStamp), tx: first.transactionHash ?? first.hash ?? null };
}

/** Whether an address funds so many wallets that sharing it means nothing: a contract, or a very busy wallet. */
async function isService(address, chain) {
  const [sent, code] = await Promise.all([
    chain.client.getTransactionCount({ address }).catch(() => 0),
    chain.client.getCode({ address }).catch(() => undefined),
  ]);
  return Boolean(code && code !== "0x") || sent > SERVICE_TXS;
}

async function firstTransferTime(token, chain) {
  const key = chain === CHAINS.robinhood ? token : `${chain.key}:${token}`;
  if (firstTransferAt.has(key)) return firstTransferAt.get(key);
  let at = null;
  if (chain === CHAINS.robinhood) {
    const [first] = await blockscoutList("tokentx", { contractaddress: token, page: 1, offset: 1 });
    at = first ? Number(first.timeStamp) : null;
  } else {
    // Base's Blockscout misses many new tokens, so the first mint is read from the chain.
    const mint = await firstLog({ address: token, topics: [TRANSFER, pad("0x0")] }, 0n, await chain.client.getBlockNumber(), chain);
    at = mint?.blockTimestamp ? Number(mint.blockTimestamp) : null;
  }
  if (at !== null) {
    if (firstTransferAt.size > 20_000) firstTransferAt.clear();
    firstTransferAt.set(key, at);
  }
  return at;
}

/** Other tokens a wallet bought within the snipe window of their first transfer. */
async function otherSnipes(wallet, token, chain) {
  const rows = await blockscoutList("tokentx", { address: wallet, sort: "desc", page: 1, offset: 200 }, chain);
  const earliest = new Map(); // other token -> the wallet's earliest receipt of it in these rows
  for (const t of rows) {
    const tk = low(t.contractAddress);
    if (tk === token || low(t.to) !== wallet) continue;
    earliest.set(tk, { at: Number(t.timeStamp), symbol: t.tokenSymbol ?? null, tx: t.hash });
  }
  const recent = [...earliest].slice(0, REPEAT_TOKENS);
  const hits = await Promise.all(
    recent.map(async ([tk, got]) => {
      const start = await firstTransferTime(tk, chain).catch(() => null);
      const after = start === null ? null : got.at - start;
      return after !== null && after >= 0 && after <= SNIPE_SECONDS ? { token: tk, symbol: got.symbol, secondsAfterLaunch: after, tx: got.tx } : null;
    }),
  );
  return hits.filter(Boolean);
}

async function checkRobinhood(token) {
  const chain = CHAINS.robinhood;
  const started = Date.now();
  const [page, info, early, meta, supply, latest, about] = await Promise.all([
    blockscout(`/api/v2/tokens/${token}/holders`),
    blockscout(`/api/v2/tokens/${token}`),
    blockscoutList("tokentx", { contractaddress: token, page: 1, offset: EARLY_ROWS }),
    tokenMeta(token),
    rh.readContract({ address: token, abi: erc20, functionName: "totalSupply" }).catch(() => null),
    rh.getBlockNumber(),
    blockscout(`/api/v2/addresses/${token}`),
  ]);
  if (!supply || meta.symbol === null || !page?.items) {
    return { status: 404, body: { error: "not_found", message: "No token found at this address on Robinhood Chain." } };
  }
  const creationTx = about?.creation_transaction_hash ?? about?.creation_tx_hash ?? null;
  const [launch, created] = await Promise.all([
    findLaunch(token, latest).catch(() => null),
    creationTx ? blockscout(`/api/v2/transactions/${creationTx}`).catch(() => null) : null,
  ]);
  const dev = launch?.creator ?? (low(created?.from?.hash) || null);
  // Where the whole supply went first: the launch contract that buyers then buy from.
  const launchSource = launch?.curve ?? (early[0] && low(early[0].from) === ZERO ? low(early[0].to) : null);

  return report({
    chain, token, started, meta, supply, dev, launchSource, early,
    holders: page.items.map((h) => ({ address: low(h.address.hash), value: h.value, name: h.address.name ?? null, isContract: Boolean(h.address.is_contract) })),
    holdersCount: Number(info?.holders_count ?? info?.holders ?? 0) || null,
    buyFrom: launchSource ? new Set([launchSource]) : null,
    windowFullyRead: (t0) => early.length < EARLY_ROWS || Number(early.at(-1).timeStamp) > t0 + SNIPE_SECONDS,
  });
}

async function checkBase(token) {
  const chain = CHAINS.base;
  const started = Date.now();
  const [page, info, meta, supply, origin] = await Promise.all([
    blockscout(`/api/v2/tokens/${token}/holders`, {}, chain).catch(() => null),
    blockscout(`/api/v2/tokens/${token}`, {}, chain).catch(() => null),
    tokenMeta(token, chain),
    chain.client.readContract({ address: token, abi: erc20, functionName: "totalSupply" }).catch(() => null),
    baseOrigin(token).catch(() => null),
  ]);
  const indexed = Boolean(page?.items?.length);
  if (!supply || meta.symbol === null || (!indexed && !origin)) {
    return { status: 404, body: { error: "not_found", message: "No token found at this address on Base." } };
  }
  const dev = origin?.launch?.creator ?? origin?.sender ?? null;
  const launchSource = origin?.mintedTo ?? null;

  // The first seconds after the mint, read from the chain.
  const early = origin
    ? (await logsBetween({ address: token, topics: [TRANSFER] }, origin.block, origin.block + BASE_SNIPE_BLOCKS, chain)).map(transferRow)
    : [];

  let holders, holdersCount;
  if (indexed) {
    holders = page.items.map((h) => ({ address: low(h.address.hash), value: h.value, name: h.address.name ?? null, isContract: Boolean(h.address.is_contract) }));
    holdersCount = Number(info?.holders_count ?? info?.holders ?? 0) || null;
  } else {
    // Not indexed yet: add up every transfer since the mint.
    const balances = new Map();
    const logs = await logsBetween({ address: token, topics: [TRANSFER] }, origin.block, origin.latest, chain);
    for (const l of logs) {
      const t = transferRow(l);
      const value = BigInt(t.value);
      if (t.from !== ZERO) balances.set(t.from, (balances.get(t.from) ?? 0n) - value);
      balances.set(t.to, (balances.get(t.to) ?? 0n) + value);
    }
    const held = [...balances].filter(([a, b]) => b > 0n && a !== ZERO);
    holdersCount = held.length;
    const top = held.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0)).slice(0, TOP);
    holders = await Promise.all(
      top.map(async ([address, value]) => {
        const code = await chain.client.getCode({ address }).catch(() => undefined);
        const isContract = Boolean(code && code !== "0x");
        return { address, value: value.toString(), name: isContract ? await contractName(address, chain) : null, isContract };
      }),
    );
  }

  // Unnamed contracts among the top holders may be the token's own v2 or v3 pool.
  await Promise.all(
    holders.slice(0, TOP).map(async (h) => {
      if (h.isContract && !/pool|pair/i.test(h.name ?? "") && (await isPoolOf(h.address, token, chain.client))) h.pool = true;
    }),
  );

  // The launch transaction itself hands the supply to the pool, vaults and airdrops: those aren't buys.
  const launchTx = origin?.tx ?? null;
  const trading = early.filter((e) => e.hash !== launchTx);

  // Buys in the first seconds come from the v4 pool, the contract the supply was minted to, or the market that sent
  // to the most wallets (a v3 pool or a curve this API doesn't know by name).
  const fanOut = new Map();
  for (const e of trading) if (e.from !== ZERO) fanOut.set(e.from, new Set([...(fanOut.get(e.from) ?? []), e.to]));
  const busiest = [...fanOut].sort((x, y) => y[1].size - x[1].size)[0]?.[0] ?? null;
  const pools = holders.filter((h) => h.pool).map((h) => h.address);
  const buyFrom = new Set([chain.poolManager, launchSource, busiest, ...pools].filter(Boolean));

  return report({
    chain, token, started, meta, supply, dev, launchSource, early, holders, holdersCount, buyFrom,
    notBuys: launchTx ? new Set([launchTx]) : null,
    windowFullyRead: () => true,
    holdersFrom: indexed ? "Base's Blockscout" : "every transfer since the mint, read from the chain",
  });
}

/** The report from what was read, the same on both chains. */
async function report({ chain, token, started, meta, supply, dev, launchSource, early, holders, holdersCount, buyFrom, notBuys, windowFullyRead, holdersFrom }) {
  const client = chain.client;
  const unit = 10 ** meta.decimals;
  const pct = (raw) => Number((BigInt(raw) * 1_000_000n) / supply) / 10_000;

  // ---- 1. Top holders
  const rows = holders.slice(0, TOP).map((h) => {
    const { address, isContract } = h;
    const infra = h.pool ? "pool" : infraKind(address, h.name, isContract, launchSource, chain);
    return {
      address,
      name: h.name ?? null,
      percent: pct(h.value),
      kind: infra ?? (isContract ? "contract" : "wallet"),
      ...(address === dev ? { isCreator: true } : {}),
    };
  });
  const sum = (list) => list.reduce((s, r) => s + r.percent, 0);
  const wallets = rows.filter((r) => r.kind === "wallet");

  // ---- 2. Linked wallets: the same first funder, once exchanges and other services are set aside
  // Started here and collected after the sniper steps, so the two run side by side.
  const linking = (async () => {
  await Promise.all(wallets.map(async (r) => { r.funding = await firstFunder(r.address, chain).catch(() => null); }));
  const funders = [...new Set(wallets.map((r) => r.funding?.funder).filter(Boolean))];
  const service = new Map(await Promise.all(funders.map(async (f) => [f, await isService(f, chain)])));
  const byFunder = new Map();
  for (const r of wallets) {
    const f = r.funding?.funder;
    if (!f) continue;
    r.funding.funderIsService = service.get(f);
    if (!service.get(f)) byFunder.set(f, [...(byFunder.get(f) ?? []), r]);
  }
  const linkedGroups = [...byFunder]
    .filter(([, list]) => list.length > 1)
    .map(([funder, list]) => {
      const times = list.map((r) => r.funding.at);
      return {
        funder,
        funderIsCreator: funder === dev,
        wallets: list.map((r) => ({ address: r.address, percent: r.percent, fundedEth: r.funding.eth, fundedAt: r.funding.time, tx: r.funding.tx })),
        percent: sum(list),
        fundedWithinADay: Math.max(...times) - Math.min(...times) <= 86_400,
        confidence: "probable",
      };
    })
    .sort((a, b) => b.percent - a.percent);
  const fundedByCreator = dev ? wallets.filter((r) => r.funding?.funder === dev && r.address !== dev) : [];
  for (const r of wallets) if (r.funding) delete r.funding.at;
  return { linkedGroups, fundedByCreator, service };
  })();

  // ---- 3. Snipers: buys from the launch contract in the first seconds, leaving out the creator
  const snipers = { windowSeconds: SNIPE_SECONDS, count: 0, boughtPercent: 0, stillHoldPercent: 0, buyers: [] };
  const sameBlock = new Map();
  if (early.length && buyFrom?.size) {
    const t0 = Number(early[0].timeStamp);
    const bought = new Map();
    for (const e of early) {
      const to = low(e.to);
      if (!buyFrom.has(low(e.from)) || Number(e.timeStamp) > t0 + SNIPE_SECONDS || notBuys?.has(e.hash)) continue;
      if (to === dev || buyFrom.has(to) || infraKind(to, null, false, launchSource, chain)) continue;
      const b = bought.get(to) ?? { address: to, raw: 0n, firstTx: e.hash, secondsAfterLaunch: Number(e.timeStamp) - t0 };
      b.raw += BigInt(e.value);
      bought.set(to, b);
      sameBlock.set(e.blockNumber, new Set([...(sameBlock.get(e.blockNumber) ?? []), to]));
    }
    const all = [...bought.values()].sort((a, b) => (a.raw > b.raw ? -1 : 1));
    const listed = all.slice(0, SNIPERS_LISTED);
    const held = await Promise.all(
      listed.map((s) => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [s.address] }).catch(() => null)),
    );
    snipers.count = all.length;
    snipers.boughtPercent = all.reduce((s, b) => s + pct(b.raw), 0);
    snipers.buyers = listed.map(({ raw, ...s }, i) => ({ ...s, boughtPercent: pct(raw), stillHoldsPercent: held[i] === null ? null : pct(held[i]) }));
    snipers.stillHoldPercent = snipers.buyers.reduce((s, b) => s + (b.stillHoldsPercent ?? 0), 0);
    // The first rows may not reach the end of the window on a very busy launch.
    snipers.windowFullyRead = windowFullyRead(t0);
  }
  const sameBlockBuyers = [...sameBlock]
    .filter(([, set]) => set.size > 1)
    .map(([block, set]) => ({ block: Number(block), wallets: [...set] }));

  // ---- 4. Repeat snipers: did the biggest early buyers snipe other launches too?
  let repeatChecked = false;
  if (snipers.buyers.length && Date.now() - started < REPEAT_DEADLINE_MS) {
    const top = snipers.buyers.slice(0, REPEAT_CHECKED);
    const found = await Promise.all(top.map((s) => otherSnipes(s.address, token, chain).catch(() => null)));
    top.forEach((s, i) => { s.otherLaunchesSniped = found[i]; });
    repeatChecked = true;
  }
  const repeaters = snipers.buyers.filter((s) => s.otherLaunchesSniped?.length);
  const { linkedGroups, fundedByCreator, service } = await linking;

  const infra = rows.filter((r) => ["burn", "pool", "launch"].includes(r.kind));
  const unknown = rows.filter((r) => r.kind === "contract");
  const ranked = [...wallets].sort((a, b) => b.percent - a.percent);
  const summary = {
    poolLaunchBurnPercent: sum(infra),
    unknownContractsPercent: sum(unknown),
    largestWalletPercent: ranked[0]?.percent ?? 0,
    top10WalletsPercent: sum(ranked.slice(0, 10)),
    snipersBoughtPercent: snipers.boughtPercent,
    snipersStillHoldPercent: snipers.stillHoldPercent,
    linkedGroupsPercent: sum(linkedGroups),
  };

  const flags = [];
  const flag = (severity, text) => flags.push({ severity, text });
  const n = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (snipers.boughtPercent >= 10) {
    flag("warn", `${n(snipers.count, "wallet")} bought ${snipers.boughtPercent.toFixed(1)}% of the supply in the first ${SNIPE_SECONDS} seconds and still hold ${snipers.stillHoldPercent.toFixed(1)}%`);
  }
  if (linkedGroups.length) {
    flag("warn", `${n(linkedGroups.length, "group")} of top holders share a first funder and hold ${summary.linkedGroupsPercent.toFixed(1)}% together: probably the same person, not proven`);
  }
  if (fundedByCreator.length) {
    flag("warn", `${n(fundedByCreator.length, "top holder")} got their first ETH from the creator's wallet and hold ${sum(fundedByCreator).toFixed(1)}%`);
  }
  if (sameBlockBuyers.length) flag("info", `Several wallets bought in the same block at launch, ${n(sameBlockBuyers.length, "time")}: typical of a bundled buy`);
  if (repeaters.length) flag("info", `${n(repeaters.length, "early buyer")} of the top ${Math.min(REPEAT_CHECKED, snipers.buyers.length)} also sniped other launches`);
  if (summary.unknownContractsPercent >= 10) flag("info", `Unnamed contracts hold ${summary.unknownContractsPercent.toFixed(1)}%: likely bots or smart wallets, not counted as people`);
  if (summary.top10WalletsPercent >= 30) flag("warn", `The ten largest wallets hold ${summary.top10WalletsPercent.toFixed(1)}% of the supply`);
  else if (summary.largestWalletPercent >= 5) flag("info", `The largest wallet holds ${summary.largestWalletPercent.toFixed(1)}% of the supply`);
  if (!flags.length) flag("info", "Nothing stands out in who holds this token or how it launched");

  return {
    status: 200,
    body: {
      ...(chain === CHAINS.robinhood ? {} : { chain: chain.key, holdersFrom }),
      token: { address: token, name: meta.name, symbol: meta.symbol, holders: holdersCount },
      creator: dev,
      flags,
      summary,
      topHolders: rows,
      linkedGroups,
      servicesIgnored: [...service].filter(([, is]) => is).map(([a]) => a),
      snipers,
      sameBlockBuyers,
      repeatSnipersChecked: repeatChecked,
      explorer: `${chain.explorer}/token/${token}`,
      note: `Read from public on-chain data. Covers the top ${TOP} holders. Linked groups share a first funder, with exchanges and services left out: probable, never proven. Unnamed contracts are likely bots or smart wallets. Not financial advice.`,
      updatedAt: new Date().toISOString(),
    },
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  if (!hasBlockscout()) return sendJson(res, 503, { error: "not_configured", message: "This API isn't set up yet." });
  const token = String(req.query.token ?? "").trim().toLowerCase();
  if (!isAddress(token)) {
    return sendJson(res, 400, { error: "bad_token", message: "Pass a token contract address: /v1/holders/0x…" });
  }
  const asked = chainRequest(req.query);
  if (!asked) return sendJson(res, 400, badChain);
  if (!chainReady(asked.chain)) return sendJson(res, 503, chainNotReady);
  const key = asked.key(token);
  try {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return sendJson(res, hit.status, hit.body);
    // Left out, the chain is Robinhood Chain, or Base when the token is only there (src: _lib.js checkOnChain).
    const result = await checkOnChain(asked, token, { robinhood: checkRobinhood, base: checkBase });
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), ...result });
    return sendJson(res, result.status, result.body);
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain data right now. Try again." });
  }
}
