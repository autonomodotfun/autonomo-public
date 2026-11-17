// Official Autonomo API: what a token's creator did with the supply and the fees.
//
// GET /v1/dev/<token address>   (header: x-api-key: <TOOLS_API_KEY>)
//
// Finds the creator (the launchpad's launch event when there is one, otherwise whoever sent the transaction that
// created the contract), then reports what they bought, burned, locked, sold, put in the pool and still hold, the creator fees they
// claimed and still have waiting, where their ETH went, who first funded their wallet, and the other tokens the
// creator and that funder have launched on the launchpad.
//
// The chain itself can't answer "everything this wallet ever did", so the wallet's history comes from the Blockscout
// PRO API (BLOCKSCOUT_KEY, about 6 to 10 requests a call). Balances, supply, pending fees and launches are read from
// the chain. Based on the audit method in an advisor's notes (Nov 2026).
//
// A link between wallets is never proof: the funder is reported with the evidence, for the caller to check.
//
// ?chain=base reads Base instead. There the creator comes from the Clanker or Zora launch event in the transaction
// that minted the token (otherwise whoever sent that transaction), and the creator's token moves are read from the
// chain itself, since Base's Blockscout misses many new tokens. Creator fees aren't tracked on Base yet.

import { isAddress, pad } from "viem";
import {
  addr, authorized, badChain, chainNotReady, chainReady, withBaseHint, baseLaunchesBy, baseOrigin, blockscout, blockscoutList, chainOf, CHAINS, erc20, FACTORY, findLaunch,
  fullHistory, LAUNCHED, LAUNCHPAD_START, logsBetween, rh, sendJson, tokenMeta, TRANSFER, transferRow,
} from "./_lib.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952"; // PonsV2LaunchLocker: no way to send tokens out
const FEE_ESCROW = "0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e"; // PonsV2FeeEscrow: pays creator fees in ETH
// A funder that has sent more transactions than this is an exchange or a service, not a person behind the creator.
const SERVICE_TXS = 5000;
const RECENT_SPAN = 9_000_000n; // ~13 days: how far launch searches look on the public RPC
const LIST_MAX = 50; // rows of each list in the answer; totals always cover everything read
const LOOKUPS = 3; // unknown addresses the creator sent tokens to that get a name lookup

const CACHE_MS = 10 * 60_000;
const cache = new Map(); // token -> { at, status, body }

const iso = (ts) => new Date(Number(ts) * 1000).toISOString();
const eth = (wei) => Number(wei) / 1e18;
const low = (a) => String(a ?? "").toLowerCase();
const list = blockscoutList;

/** Tokens a wallet launched on the launchpad, read from the factory's launch events. */
async function launchesBy(wallet, latest) {
  const recent = latest > RECENT_SPAN ? latest - RECENT_SPAN : 0n;
  const from = fullHistory() ? LAUNCHPAD_START : recent > LAUNCHPAD_START ? recent : LAUNCHPAD_START;
  const logs = await logsBetween({ address: FACTORY, topics: [LAUNCHED, null, null, pad(wallet)] }, from, latest);
  return logs.map((l) => ({ token: addr(l.topics[1]), tx: l.transactionHash }));
}

/** What one token transfer of the creator's was: bought, burned, locked, sold, or just moved. */
export function classify(incoming, other, launchSource, chain = CHAINS.robinhood) {
  const venue = other === chain.poolManager || (launchSource && other === launchSource);
  if (incoming) return other === ZERO ? "minted" : venue ? "bought" : "received";
  if (other === ZERO || other === DEAD) return "burned";
  if (other === LOCKER) return "locked";
  return venue ? "sold" : "sent";
}

async function checkRobinhood(token) {
  const chain = CHAINS.robinhood;
  const [info, latest, meta, supply] = await Promise.all([
    blockscout(`/api/v2/addresses/${token}`),
    rh.getBlockNumber(),
    tokenMeta(token),
    rh.readContract({ address: token, abi: erc20, functionName: "totalSupply" }).catch(() => null),
  ]);
  const creationTx = info?.creation_transaction_hash ?? info?.creation_tx_hash ?? null;
  if (!supply || meta.symbol === null) {
    return { status: 404, body: { error: "not_found", message: "No token found at this address on Robinhood Chain." } };
  }

  // The launch event names the creator even when someone else sent the transaction. Older tokens fall back to the
  // sender of the transaction that created the contract.
  const [launch, created] = await Promise.all([
    findLaunch(token, latest).catch(() => null),
    creationTx ? blockscout(`/api/v2/transactions/${creationTx}`) : null,
  ]);
  const dev = launch?.creator ?? low(created?.from?.hash);
  if (!isAddress(dev)) {
    return { status: 404, body: { error: "creator_not_found", message: "Couldn't find who created this token." } };
  }

  const [moves, firstTransfer, internal, normal, balance, pendingFees, ownLaunches] = await Promise.all([
    list("tokentx", { contractaddress: token, address: dev }),
    launch ? [] : list("tokentx", { contractaddress: token, page: 1, offset: 1 }),
    list("txlistinternal", { address: dev }),
    list("txlist", { address: dev }),
    rh.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [dev] }).catch(() => 0n),
    rh.readContract({ address: FEE_ESCROW, abi: erc20, functionName: "balanceOf", args: [dev] }).catch(() => null),
    launchesBy(dev, latest).catch(() => null),
  ]);
  // Where the supply first went: the bonding curve. Trades with it, or with the v4 pool, are buys and sells.
  const launchSource = launch?.curve ?? (firstTransfer[0] ? low(firstTransfer[0].to) : null);

  return report({
    chain, token, meta, supply, dev, launchSource, moves, internal, normal, balance, ownLaunches,
    creator: {
      address: dev,
      foundFrom: launch ? "launchpad launch event" : "contract creation transaction",
      launchTx: launch?.tx ?? creationTx,
      launchedAt: created?.timestamp ?? null,
    },
    fees: { from: FEE_ESCROW, pending: pendingFees },
    launchesOf: (wallet) => launchesBy(wallet, latest),
    where: "on the launchpad",
    launchSearch: fullHistory() ? "the launchpad's whole history" : "the last 13 days or so",
  });
}

async function checkBase(token) {
  const chain = CHAINS.base;
  const [meta, supply, origin] = await Promise.all([
    tokenMeta(token, chain),
    chain.client.readContract({ address: token, abi: erc20, functionName: "totalSupply" }).catch(() => null),
    baseOrigin(token).catch(() => null),
  ]);
  if (!supply || meta.symbol === null) {
    return { status: 404, body: { error: "not_found", message: "No token found at this address on Base." } };
  }
  const dev = origin?.launch?.creator ?? origin?.sender;
  if (!origin || !isAddress(dev ?? "")) {
    return { status: 404, body: { error: "creator_not_found", message: "Couldn't find who created this token." } };
  }

  // The creator's token moves, straight from the chain: Base's Blockscout misses many new tokens.
  const mine = pad(dev);
  const [incoming, outgoing, internal, normal, balance, ownLaunches] = await Promise.all([
    logsBetween({ address: token, topics: [TRANSFER, null, mine] }, origin.block, origin.latest, chain),
    logsBetween({ address: token, topics: [TRANSFER, mine] }, origin.block, origin.latest, chain),
    list("txlistinternal", { address: dev }, chain),
    list("txlist", { address: dev }, chain),
    chain.client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [dev] }).catch(() => 0n),
    baseLaunchesBy(dev),
  ]);
  const seen = new Set();
  const moves = [...incoming, ...outgoing]
    .filter((l) => {
      const id = `${l.transactionHash}:${l.logIndex}`;
      return !seen.has(id) && seen.add(id);
    })
    .map(transferRow)
    .sort((x, y) => Number(x.blockNumber) - Number(y.blockNumber) || x.logIndex - y.logIndex);

  return report({
    chain, token, meta, supply, dev, launchSource: origin.mintedTo, moves, internal, normal, balance, ownLaunches,
    creator: {
      address: dev,
      foundFrom: origin.launch ? `${origin.launch.launchpad} launch event` : "the transaction that minted the token",
      launchpad: origin.launch?.launchpad ?? null,
      launchTx: origin.tx,
      launchedAt: origin.time ? iso(origin.time) : null,
    },
    fees: null,
    launchesOf: (wallet) => baseLaunchesBy(wallet),
    where: "on Clanker or Zora",
    launchSearch: "Clanker and Zora's whole history on Base",
  });
}

/** The report from what was read, the same on both chains. */
async function report({ chain, token, meta, supply, dev, launchSource, moves, internal, normal, balance, ownLaunches, creator, fees, launchesOf, where, launchSearch }) {
  const feeFrom = fees?.from ?? null;

  const unit = 10 ** meta.decimals;
  const pct = (raw) => Number((raw * 1_000_000n) / supply) / 10_000;
  const totals = { minted: 0n, bought: 0n, received: 0n, burned: 0n, locked: 0n, sold: 0n, pooled: 0n, sent: 0n };
  // A sale pays the creator ETH in the same transaction. Tokens that reach the pool with no ETH coming back were
  // more likely added as liquidity, so they are reported apart from sales.
  // Adding liquidity also sends ETH in, and any ETH that comes back is only the unused part, so a transaction the
  // creator paid ETH into is never counted as a sale.
  const gotEth = new Set(internal.filter((t) => low(t.to) === dev && BigInt(t.value || 0) > 0n).map((t) => low(t.transactionHash ?? t.hash)));
  const spentEth = new Set(normal.filter((t) => low(t.from) === dev && BigInt(t.value || 0) > 0n).map((t) => low(t.hash)));
  const paidIn = { has: (hash) => gotEth.has(hash) && !spentEth.has(hash) };
  const rows = moves.map((t) => {
    const incoming = low(t.to) === dev;
    const other = low(incoming ? t.from : t.to);
    const raw = BigInt(t.value);
    const type = classify(incoming, other, launchSource, chain);
    return { time: iso(t.timeStamp), type: type === "sold" && !paidIn.has(low(t.hash)) ? "pooled" : type, raw, counterparty: other, tx: t.hash };
  });

  // Tokens sent to an address we don't know may still be a lock or a sale: name the biggest few and look again.
  const sentTo = new Map();
  for (const r of rows) if (r.type === "sent") sentTo.set(r.counterparty, (sentTo.get(r.counterparty) ?? 0n) + r.raw);
  const biggest = [...sentTo].sort((a, b) => (a[1] > b[1] ? -1 : 1)).slice(0, LOOKUPS).map(([a]) => a);
  const named = new Map();
  for (const a of biggest) {
    const who = await blockscout(`/api/v2/addresses/${a}`, {}, chain).catch(() => null);
    if (who) named.set(a, { name: who.name ?? null, isContract: Boolean(who.is_contract) });
  }
  for (const r of rows) {
    const who = named.get(r.counterparty);
    if (!who) continue;
    r.counterpartyName = who.name;
    r.counterpartyIsContract = who.isContract;
    if (r.type === "sent" && who.isContract && /lock|vest/i.test(who.name ?? "")) r.type = "locked";
    else if (r.type === "sent" && who.isContract && /pool|pair|router/i.test(who.name ?? "")) r.type = paidIn.has(low(r.tx)) ? "sold" : "pooled";
  }
  for (const r of rows) totals[r.type] += r.raw;

  // Creator fees: ETH the fee escrow paid out to the creator, and what is still waiting there (Robinhood Chain only).
  const claims = internal
    .filter((t) => feeFrom && low(t.from) === feeFrom && low(t.to) === dev && BigInt(t.value || 0) > 0n)
    .map((t) => ({ time: iso(t.timeStamp), eth: eth(t.value), tx: t.transactionHash ?? t.hash ?? null }));
  const claimedEth = claims.reduce((s, c) => s + c.eth, 0);

  // Where the creator's ETH went, by who received it.
  const recipients = new Map();
  for (const t of normal) {
    if (low(t.from) !== dev || t.isError === "1" || BigInt(t.value || 0) === 0n) continue;
    const to = low(t.to);
    const r = recipients.get(to) ?? { address: to, eth: 0, transactions: 0, lastTime: null, lastTx: null };
    r.eth += eth(t.value);
    r.transactions += 1;
    r.lastTime = iso(t.timeStamp);
    r.lastTx = t.hash;
    recipients.set(to, r);
  }
  const sentEth = [...recipients.values()].sort((a, b) => b.eth - a.eth);

  // Who funded the wallet: the earliest ETH that reached it, sent directly or from inside a contract.
  const firstIn = [...normal.filter((t) => t.isError !== "1"), ...internal]
    .filter((t) => low(t.to) === dev && BigInt(t.value || 0) > 0n && low(t.from) !== feeFrom)
    .sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp))[0];
  let funding = null;
  if (firstIn) {
    const funder = low(firstIn.from);
    const [sent, code] = await Promise.all([
      chain.client.getTransactionCount({ address: funder }).catch(() => null),
      chain.client.getCode({ address: funder }).catch(() => undefined),
    ]);
    const isContract = Boolean(code && code !== "0x");
    const isService = isContract || (sent ?? 0) > SERVICE_TXS;
    const launches = isService ? null : await launchesOf(funder).catch(() => null);
    funding = {
      funder,
      eth: eth(firstIn.value),
      time: iso(firstIn.timeStamp),
      tx: firstIn.transactionHash ?? firstIn.hash ?? null,
      funderTransactionsSent: sent,
      funderIsContract: isContract,
      // An exchange or bridge funds thousands of wallets, so sharing one says nothing about who is behind them.
      funderIsService: isService,
      funderLaunches: launches && { count: launches.length, tokens: launches.slice(0, 20) },
    };
  }
  const otherLaunches = ownLaunches?.filter((l) => l.token !== token) ?? null;

  const holds = pct(balance);
  const flags = [];
  const flag = (severity, text) => flags.push({ severity, text });
  if (totals.sold > 0n) flag("warn", `The creator sold ${pct(totals.sold).toFixed(2)}% of the supply`);
  if (totals.pooled > 0n) flag("info", `The creator moved ${pct(totals.pooled).toFixed(2)}% of the supply into the trading pool without being paid ETH for it in the same transaction: more likely added liquidity than a sale`);
  if (totals.burned > 0n) flag("good", `The creator burned ${pct(totals.burned).toFixed(2)}% of the supply`);
  if (totals.locked > 0n) flag("good", `The creator locked ${pct(totals.locked).toFixed(2)}% of the supply`);
  if (totals.sent > 0n) flag("info", `The creator sent ${pct(totals.sent).toFixed(2)}% of the supply to other addresses: check who received it`);
  if (holds >= 5) flag("info", `The creator still holds ${holds.toFixed(2)}% of the supply`);
  if (claimedEth > 0) flag("info", `The creator has claimed ${claimedEth.toFixed(4)} ETH in creator fees`);
  if (otherLaunches?.length) flag("warn", `The creator launched ${otherLaunches.length} other token${otherLaunches.length === 1 ? "" : "s"} ${where}`);
  const funderCount = funding?.funderLaunches?.count ?? 0;
  if (funderCount > 0) flag("warn", `The wallet that first funded the creator has launched ${funderCount} token${funderCount === 1 ? "" : "s"} itself: a probable link, not proof`);
  if (!flags.length) flag("info", "Nothing stands out in what the creator did");

  return {
    status: 200,
    body: {
      ...(chain === CHAINS.robinhood ? {} : { chain: chain.key }),
      token: { address: token, name: meta.name, symbol: meta.symbol },
      creator,
      flags,
      supply: {
        holdsPercent: holds,
        holdsTokens: Number(balance) / unit,
        boughtPercent: pct(totals.bought),
        mintedPercent: pct(totals.minted),
        receivedPercent: pct(totals.received),
        soldPercent: pct(totals.sold),
        pooledPercent: pct(totals.pooled),
        burnedPercent: pct(totals.burned),
        lockedPercent: pct(totals.locked),
        sentPercent: pct(totals.sent),
      },
      tokenMoves: {
        count: rows.length,
        list: rows.slice(-LIST_MAX).map(({ raw, ...r }) => ({ ...r, tokens: Number(raw) / unit, percent: pct(raw) })),
      },
      // Creator fees are tracked on Robinhood Chain's launchpad only, so on Base this is null.
      fees: fees && {
        claimedEth,
        pendingEth: fees.pending === null ? null : eth(fees.pending),
        claims: claims.slice(-LIST_MAX),
      },
      ethSent: {
        totalEth: sentEth.reduce((s, r) => s + r.eth, 0),
        recipients: sentEth.slice(0, 10),
      },
      funding,
      otherLaunches: otherLaunches && { count: otherLaunches.length, tokens: otherLaunches.slice(0, 20) },
      launchSearch,
      explorer: `${chain.explorer}/address/${dev}`,
      note: "Read from public on-chain data. 'Sent' can be a sale, a lock or a move to another wallet: check who received it. A funder is a probable link, never proof. Not financial advice.",
      updatedAt: new Date().toISOString(),
    },
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  if (!process.env.BLOCKSCOUT_KEY?.trim()) {
    return sendJson(res, 503, { error: "not_configured", message: "This API isn't set up yet." });
  }
  const token = String(req.query.token ?? "").trim().toLowerCase();
  if (!isAddress(token)) {
    return sendJson(res, 400, { error: "bad_token", message: "Pass a token contract address: /v1/dev/0x…" });
  }
  const chain = chainOf(req.query);
  if (!chain) return sendJson(res, 400, badChain);
  if (!chainReady(chain)) return sendJson(res, 503, chainNotReady);
  const key = chain === CHAINS.robinhood ? token : `${chain.key}:${token}`;
  try {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return sendJson(res, hit.status, hit.body);
    // A Base token asked for without chain=base gets a 404 that says so. A 404 is never charged.
    const result = chain === CHAINS.base ? await checkBase(token) : await withBaseHint(await checkRobinhood(token), token);
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), ...result });
    return sendJson(res, result.status, result.body);
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain data right now. Try again." });
  }
}
