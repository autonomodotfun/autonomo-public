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
// Three further reads, each within a shared time limit and each left out (and named in `incomplete`) when it can't
// finish:
//   - the funding trail: who funded the funder, up to four steps back, stopping at an exchange, a bridge or a contract
//   - how the creator's earlier launches ended: what they hold and sold of each, its holders and its last transfer
//   - where the creator's ETH came from, by sender, so fees from any launchpad show up, not only this one's escrow
// They cost up to about 27 more Blockscout requests. ?depth=basic skips them, for callers that need the old speed.
//
// ?chain=base reads Base instead. There the creator comes from the Clanker or Zora launch event in the transaction
// that minted the token (otherwise whoever sent that transaction), and the creator's token moves are read from the
// chain itself, since Base's Blockscout misses many new tokens. Creator fees aren't tracked on Base yet.

import { isAddress, pad } from "viem";
import {
  addr, authorized, badChain, chainNotReady, chainReady, chainRequest, checkOnChain, baseLaunchesBy, baseOrigin, blockscout, blockscoutList, CHAINS, contractName, erc20, FACTORY, findLaunch,
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
const TRAIL_STEPS = 4; // how far back the creator's funding is followed
const OUTCOMES = 5; // earlier launches whose outcome is read, newest first
const SENDERS = 8; // senders of the creator's ETH that are listed
const SENDER_NAMES = 4; // of those, how many get a name lookup
const QUIET_DAYS = 7; // a token with no transfer for this long has gone quiet
const EXTRAS_MS = 9_000; // the further reads share this much time, so a report stays well inside the gateway's 25 s
const WETH_BASE = "0x4200000000000000000000000000000000000006";

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
  return logs.map((l) => ({ token: addr(l.topics[1]), tx: l.transactionHash, curve: addr(l.topics[2]) }));
}

/** The earliest ETH that reached a wallet, sent directly or from inside a contract. Null when the lists hold none. */
export function firstFunding(wallet, normal, internal, skipFrom = null) {
  return (
    [...normal.filter((t) => t.isError !== "1"), ...internal]
      .filter((t) => low(t.to) === wallet && BigInt(t.value || 0) > 0n && low(t.from) !== skipFrom)
      .sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp))[0] ?? null
  );
}

/** The ETH a wallet received, by who sent it, largest first. */
export function incomeBySender(wallet, normal, internal) {
  const by = new Map();
  for (const t of [...normal.filter((x) => x.isError !== "1"), ...internal]) {
    if (low(t.to) !== wallet || BigInt(t.value || 0) === 0n) continue;
    const from = low(t.from);
    const r = by.get(from) ?? { address: from, eth: 0, transactions: 0, firstTime: null, lastTime: null, lastTx: null };
    const time = iso(t.timeStamp);
    r.eth += eth(t.value);
    r.transactions += 1;
    if (!r.firstTime || time < r.firstTime) r.firstTime = time;
    if (!r.lastTime || time >= r.lastTime) {
      r.lastTime = time;
      r.lastTx = t.transactionHash ?? t.hash ?? null;
    }
    by.set(from, r);
  }
  return [...by.values()].sort((a, b) => b.eth - a.eth);
}

/** Whether a funder is a person's wallet or a service, and what it launched: the same facts for every step back. */
async function describeFunder(chain, funder, launchesOf) {
  const [sent, code] = await Promise.all([
    chain.client.getTransactionCount({ address: funder }).catch(() => null),
    chain.client.getCode({ address: funder }).catch(() => undefined),
  ]);
  const isContract = Boolean(code && code !== "0x");
  const isService = isContract || (sent ?? 0) > SERVICE_TXS;
  const launches = isService ? null : await launchesOf(funder).catch(() => null);
  return { funderTransactionsSent: sent, funderIsContract: isContract, funderIsService: isService, funderLaunches: launches && { count: launches.length, tokens: launches.slice(0, 20) } };
}

/**
 * The funding followed back: who funded the creator, who funded that wallet, and so on. It stops at an exchange,
 * a bridge or any contract (thousands of strangers share those, so the trail means nothing past them), at a wallet
 * it has already seen, after TRAIL_STEPS steps, or when time runs out. Every step is a probable link, never proof.
 */
async function fundingTrail({ chain, dev, funding, launchesOf, deadline }) {
  const steps = [];
  const seen = new Set([dev]);
  let wallet = dev;
  let hop = funding;
  let endedAt = hop ? "step_limit" : "not_found";
  while (hop) {
    steps.push({
      step: steps.length + 1, wallet, funder: hop.funder, eth: hop.eth, time: hop.time, tx: hop.tx,
      funderTransactionsSent: hop.funderTransactionsSent, funderIsContract: hop.funderIsContract, funderIsService: hop.funderIsService,
      funderLaunches: hop.funderLaunches?.count ?? null, funderName: null,
    });
    if (hop.funderIsService) {
      endedAt = hop.funderIsContract ? "contract" : "busy_wallet";
      break;
    }
    if (seen.has(hop.funder)) {
      endedAt = "loop";
      break;
    }
    if (steps.length >= TRAIL_STEPS) break;
    if (Date.now() > deadline) {
      endedAt = "out_of_time";
      break;
    }
    seen.add(hop.funder);
    wallet = hop.funder;
    // The first ETH in is among a wallet's earliest transactions: it can't send anything before it has gas.
    const [normal, internal] = await Promise.all([
      list("txlist", { address: wallet, page: 1, offset: 25 }, chain),
      list("txlistinternal", { address: wallet, page: 1, offset: 25 }, chain),
    ]);
    const first = firstFunding(wallet, normal, internal);
    if (!first) {
      endedAt = "not_found";
      break;
    }
    const funder = low(first.from);
    hop = { funder, eth: eth(first.value), time: iso(first.timeStamp), tx: first.transactionHash ?? first.hash ?? null, ...(await describeFunder(chain, funder, launchesOf)) };
  }
  // Who the trail ends at, when the explorer has a name for it (an exchange, a bridge).
  const last = steps.at(-1);
  if (last?.funderIsService) {
    const about = await blockscout(`/api/v2/addresses/${last.funder}`, {}, chain).catch(() => null);
    last.funderName = about?.name ?? about?.public_tags?.[0]?.display_name ?? about?.ens_domain_name ?? null;
  }
  return { steps, endedAt };
}

/**
 * How one earlier launch of the creator ended, from what was read about it. Shares are of that token's supply.
 * `historyRead` is false when the explorer had none of the creator's moves in it: then only what they hold is known.
 */
export function outcomeOf({ launch, meta, supply, balance, moves, lastTransfer, holders, dev, paidIn, chain, now }) {
  const pct = (raw) => (supply ? Number((raw * 1_000_000n) / supply) / 10_000 : null);
  const totals = { minted: 0n, bought: 0n, received: 0n, burned: 0n, locked: 0n, sold: 0n, pooled: 0n, sent: 0n };
  for (const t of moves ?? []) {
    const incoming = low(t.to) === dev;
    const type = classify(incoming, low(incoming ? t.from : t.to), launch.curve ?? null, chain);
    totals[type === "sold" && !paidIn.has(low(t.hash)) ? "pooled" : type] += BigInt(t.value);
  }
  const historyRead = Array.isArray(moves) && moves.length > 0;
  const lastAt = lastTransfer?.timeStamp ? Number(lastTransfer.timeStamp) * 1000 : null;
  return {
    token: launch.token,
    name: meta?.name ?? null,
    symbol: meta?.symbol ?? null,
    ...(launch.launchpad ? { launchpad: launch.launchpad } : {}),
    launchTx: launch.tx ?? null,
    creatorHoldsPercent: balance === null || balance === undefined ? null : pct(balance),
    creatorBoughtPercent: historyRead ? pct(totals.bought) : null,
    creatorSoldPercent: historyRead ? pct(totals.sold) : null,
    creatorBurnedPercent: historyRead ? pct(totals.burned) : null,
    creatorSentPercent: historyRead ? pct(totals.sent) : null,
    holders: holders === null || holders === undefined || Number.isNaN(Number(holders)) ? null : Number(holders),
    lastTransferAt: lastAt ? new Date(lastAt).toISOString() : null,
    daysSinceLastTransfer: lastAt ? Math.max(0, Math.floor((now - lastAt) / 86_400_000)) : null,
    historyRead,
  };
}

/** The outcome of the creator's most recent earlier launches, newest first. About 3 Blockscout requests each. */
function outcomesOf({ chain, dev, launches, paidIn }) {
  const balances = (token, fn, args) => chain.client.readContract({ address: token, abi: erc20, functionName: fn, args }).catch(() => null);
  return Promise.all(
    launches
      .slice(-OUTCOMES)
      .reverse()
      .map(async (launch) => {
        const [meta, supply, balance, moves, last, info] = await Promise.all([
          tokenMeta(launch.token, chain).catch(() => null),
          balances(launch.token, "totalSupply"),
          balances(launch.token, "balanceOf", [dev]),
          list("tokentx", { contractaddress: launch.token, address: dev }, chain).catch(() => null),
          list("tokentx", { contractaddress: launch.token, page: 1, offset: 1, sort: "desc" }, chain).catch(() => null),
          blockscout(`/api/v2/tokens/${launch.token}`, {}, chain).catch(() => null),
        ]);
        return outcomeOf({ launch, meta, supply, balance, moves, lastTransfer: last?.[0] ?? null, holders: info?.holders_count ?? info?.holder_count ?? null, dev, paidIn, chain, now: Date.now() });
      }),
  );
}

/** A promise that gives up: null once the shared time for the further reads has run out, or when it fails. */
const within = (deadline, promise) =>
  Promise.race([promise.catch(() => null), new Promise((done) => setTimeout(() => done(null), Math.max(0, deadline - Date.now())))]);

/** What one token transfer of the creator's was: bought, burned, locked, sold, or just moved. */
export function classify(incoming, other, launchSource, chain = CHAINS.robinhood) {
  const venue = other === chain.poolManager || (launchSource && other === launchSource);
  if (incoming) return other === ZERO ? "minted" : venue ? "bought" : "received";
  if (other === ZERO || other === DEAD) return "burned";
  if (other === LOCKER) return "locked";
  return venue ? "sold" : "sent";
}

async function checkRobinhood(token, extras = true) {
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
    extras,
    launchSearch: fullHistory() ? "the launchpad's whole history" : "the last 13 days or so",
  });
}

async function checkBase(token, extras = true) {
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
    extras,
    launchSearch: "Clanker and Zora's whole history on Base",
  });
}

/** The report from what was read, the same on both chains. */
async function report({ chain, token, meta, supply, dev, launchSource, moves, internal, normal, balance, ownLaunches, creator, fees, launchesOf, where, launchSearch, extras = true }) {
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

  // Where the creator's ETH came from. Fees paid by any launchpad or locker show up here as a contract that paid them.
  // Dust (a few wei sent to make an address look familiar) is counted in the total and left off the list.
  const income = incomeBySender(dev, normal, internal).filter((r) => r.eth >= 0.000001).slice(0, SENDERS);
  const incomeTotal = incomeBySender(dev, normal, internal).reduce((sum, r) => sum + r.eth, 0);

  // The further reads share one time limit, and a report never waits on them past it.
  const deadline = Date.now() + EXTRAS_MS;
  const incomplete = [];
  const [trail, outcomes, senderNames, wethIn] = extras
    ? await Promise.all([
        within(deadline, fundingTrail({ chain, dev, funding, launchesOf, deadline })),
        otherLaunches?.length ? within(deadline, outcomesOf({ chain, dev, launches: otherLaunches, paidIn })) : null,
        within(deadline, Promise.all(income.slice(0, SENDER_NAMES).map((r) => contractName(r.address, chain)))),
        // On Base, launchpads pay creators in WETH, which never shows as ETH received.
        chain === CHAINS.base ? within(deadline, list("tokentx", { address: dev, contractaddress: WETH_BASE }, chain)) : null,
      ])
    : [null, null, null, null];
  if (extras && !trail) incomplete.push("fundingTrail");
  if (extras && otherLaunches?.length && !outcomes) incomplete.push("otherLaunches.outcomes");
  if (extras && chain === CHAINS.base && !wethIn) incomplete.push("received.weth");
  const looksLikeFees = (name) => Boolean(name && /fee|locker|escrow|reward|claim|splitter|vault/i.test(name));
  const senders = income.map((r, i) => {
    const name = r.address === feeFrom ? "the launchpad's fee escrow" : (senderNames?.[i] ?? null);
    return { ...r, name, likelyFees: r.address === feeFrom || looksLikeFees(name) };
  });
  const wethSenders = wethIn
    ? incomeBySender(dev, [], wethIn.map((t) => ({ ...t, transactionHash: t.hash }))).slice(0, SENDERS)
    : null;

  const holds = pct(balance);
  const flags = [];
  // `code` never changes, so a caller can act on a flag without reading its sentence. `evidence` is up to five
  // transactions behind it, newest last.
  const flag = (severity, text, code, evidence = []) => flags.push({ code, severity, text, evidence: evidence.filter(Boolean).slice(-5) });
  const txsOf = (type) => rows.filter((r) => r.type === type).map((r) => r.tx);
  if (totals.sold > 0n) flag("warn", `The creator sold ${pct(totals.sold).toFixed(2)}% of the supply`, "creator_sold", txsOf("sold"));
  if (totals.pooled > 0n) flag("info", `The creator moved ${pct(totals.pooled).toFixed(2)}% of the supply into the trading pool without being paid ETH for it in the same transaction: more likely added liquidity than a sale`, "creator_added_liquidity", txsOf("pooled"));
  if (totals.burned > 0n) flag("good", `The creator burned ${pct(totals.burned).toFixed(2)}% of the supply`, "creator_burned", txsOf("burned"));
  if (totals.locked > 0n) flag("good", `The creator locked ${pct(totals.locked).toFixed(2)}% of the supply`, "creator_locked", txsOf("locked"));
  if (totals.sent > 0n) flag("info", `The creator sent ${pct(totals.sent).toFixed(2)}% of the supply to other addresses: check who received it`, "creator_sent_tokens", txsOf("sent"));
  if (holds >= 5) flag("info", `The creator still holds ${holds.toFixed(2)}% of the supply`, "creator_holds");
  if (claimedEth > 0) flag("info", `The creator has claimed ${claimedEth.toFixed(4)} ETH in creator fees`, "creator_fees_claimed", claims.map((c) => c.tx));
  if (otherLaunches?.length) flag("warn", `The creator launched ${otherLaunches.length} other token${otherLaunches.length === 1 ? "" : "s"} ${where}`, "creator_other_launches", otherLaunches.map((l) => l.tx));
  const funderCount = funding?.funderLaunches?.count ?? 0;
  if (funderCount > 0) flag("warn", `The wallet that first funded the creator has launched ${funderCount} token${funderCount === 1 ? "" : "s"} itself: a probable link, not proof`, "funder_launched_tokens", [funding.tx]);
  // From the further reads.
  const backer = trail?.steps.find((st) => st.step > 1 && (st.funderLaunches ?? 0) > 0);
  if (backer) {
    flag("warn", `A wallet ${backer.step} steps back in the creator's funding has launched ${backer.funderLaunches} token${backer.funderLaunches === 1 ? "" : "s"} itself: a probable link, not proof`, "funding_trail_launcher", trail.steps.slice(0, backer.step).map((st) => st.tx));
  }
  if (outcomes?.length) {
    const soldOn = outcomes.filter((o) => (o.creatorSoldPercent ?? 0) > 0);
    const quiet = outcomes.filter((o) => (o.daysSinceLastTransfer ?? 0) >= QUIET_DAYS);
    const of = `of the ${outcomes.length} earlier launch${outcomes.length === 1 ? "" : "es"} checked`;
    if (soldOn.length) flag("warn", `The creator sold tokens from ${soldOn.length} ${of}`, "earlier_launches_sold", soldOn.map((o) => o.launchTx));
    if (quiet.length) flag(quiet.length === outcomes.length ? "warn" : "info", `${quiet.length} ${of} ${quiet.length === 1 ? "has" : "have"} had no transfer for ${QUIET_DAYS} days or more`, "earlier_launches_quiet", quiet.map((o) => o.launchTx));
    // Bought at launch, then moved to other wallets: what those wallets did with them isn't read here.
    const movedOut = outcomes.filter((o) => (o.creatorSentPercent ?? 0) >= 1);
    if (movedOut.length) flag("info", `In ${movedOut.length} ${of}, the creator moved at least 1% of the supply to other wallets: check what those wallets did with it`, "earlier_launches_moved_out", movedOut.map((o) => o.launchTx));
  }
  const paidBy = senders.find((r) => r.likelyFees && r.address !== feeFrom && r.eth > 0);
  if (paidBy) flag("info", `The creator received ${paidBy.eth.toFixed(4)} ETH from ${paidBy.name}, which looks like fees`, "likely_fees_received", [paidBy.lastTx]);
  if (!flags.length) flag("info", "Nothing stands out in what the creator did", "nothing_stands_out");

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
      // The funding followed further back. Step 1 is `funding`, above. Null with depth=basic or when it couldn't be read.
      fundingTrail: trail && { steps: trail.steps, endedAt: trail.endedAt },
      // ETH the creator received, by sender. On Base, WETH too, which is how launchpads there pay creators.
      received: {
        totalEth: incomeTotal,
        senders,
        weth: wethSenders && { total: wethSenders.reduce((sum, r) => sum + r.eth, 0), senders: wethSenders },
      },
      otherLaunches: otherLaunches && {
        count: otherLaunches.length,
        tokens: otherLaunches.slice(0, 20).map(({ curve, ...l }) => l),
        // How the most recent of them ended, newest first. Null with depth=basic or when it couldn't be read.
        outcomes: outcomes ?? null,
      },
      launchSearch,
      depth: extras ? "full" : "basic",
      incomplete,
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
  const asked = chainRequest(req.query);
  if (!asked) return sendJson(res, 400, badChain);
  if (!chainReady(asked.chain)) return sendJson(res, 503, chainNotReady);
  const basic = String(req.query.depth ?? "").trim().toLowerCase() === "basic";
  const key = `${basic ? "basic:" : ""}${asked.key(token)}`;
  try {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return sendJson(res, hit.status, hit.body);
    // Left out, the chain is Robinhood Chain, or Base when the token is only there (src: _lib.js checkOnChain).
    const result = await checkOnChain(asked, token, { robinhood: (t) => checkRobinhood(t, !basic), base: (t) => checkBase(t, !basic) });
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), ...result });
    return sendJson(res, result.status, result.body);
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain data right now. Try again." });
  }
}
