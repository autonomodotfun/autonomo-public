// GET /v1/tx/<transaction hash>  (header: x-api-key)
// Explains a Robinhood Chain transaction in plain English: launches, bonding curve buys and sells, token
// transfers and ETH sent, with amounts, symbols and the fee.
//
// ?chain=base explains a Base transaction: Clanker and Zora launches, swaps (what the sender gave and got back),
// transfers, ETH sent, and the fee including Base's charge for posting to Ethereum. Left out, the chain is Robinhood
// Chain, or Base when Robinhood Chain has no such transaction (_lib.js checkOnChain).

import { formatEther, formatUnits, parseUnits } from "viem";

const parseUnitsSafe = (amount, decimals) => {
  try {
    return parseUnits(String(amount), decimals);
  } catch {
    return 0n;
  }
};
import {
  addr, authorized, badChain, baseLaunchFromLogs, BUY, chainNotReady, chainReady, chainRequest, CHAINS, checkOnChain, contractName, ethUsd,
  FACTORY, LAUNCHED, SELL, sendJson, short, tokenMeta, TRANSFER, USDG, words,
} from "./_lib.js";

const KNOWN = {
  [FACTORY]: "the launchpad",
  "0x267444d099b10fb5ed7c3cc7b7c767adca574952": "the launchpad's liquidity locker",
  "0x402085c248eea27d92e8b30b2c58ed07f9e20001": "the x402 Permit2 proxy",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Permit2",
};
// Base: the same Permit2 contracts, plus the tokens people pay and swap with.
const KNOWN_BASE = {
  "0x402085c248eea27d92e8b30b2c58ed07f9e20001": "the x402 Permit2 proxy",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Permit2",
  "0x498581ff718922c3f8e6a244956af099b2652b2b": "the Uniswap v4 PoolManager",
};
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const NAMES_LOOKED_UP = 6; // addresses in one transaction whose contract name is asked for
const cache = new Map();

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const hash = String(req.query.hash ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return sendJson(res, 400, { error: "bad_hash", message: "Pass a transaction hash: /v1/tx/0x…" });
  const asked = chainRequest(req.query);
  if (!asked) return sendJson(res, 400, badChain);
  if (!chainReady(asked.chain)) return sendJson(res, 503, chainNotReady);

  const key = asked.key(hash);
  if (cache.has(key)) return sendJson(res, 200, cache.get(key));
  try {
    const result = await checkOnChain(asked, hash, { robinhood: (h) => explainOn(h, CHAINS.robinhood), base: (h) => explainOn(h, CHAINS.base) }, {
      exists: async (h) => Boolean(await CHAINS.base.client.getTransactionReceipt({ hash: h }).catch(() => null)),
      noun: "transaction",
    });
    if (result.status === 200) {
      cache.set(key, result.body); // mined transactions never change
      if (cache.size > 2000) cache.clear();
    }
    return sendJson(res, result.status, result.body);
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}

async function explainOn(hash, chain) {
  const [tx, receipt] = await Promise.all([
    chain.client.getTransaction({ hash }).catch(() => null),
    chain.client.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx || !receipt) return { status: 404, body: { error: "not_found", message: `No such transaction on ${chain.name} (or it isn't mined yet).` } };
  return { status: 200, body: await explain(tx, receipt, chain) };
}

const usd = (n) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : n.toPrecision(2));
const fmt = (n) => {
  const x = Number(n);
  if (x === 0) return "0";
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return x >= 1 ? x.toFixed(4).replace(/\.?0+$/, "") : x.toPrecision(3);
};

async function explain(tx, receipt, chain = CHAINS.robinhood) {
  const onBase = chain === CHAINS.base;
  const known = onBase ? KNOWN_BASE : KNOWN;
  const [block, eth] = await Promise.all([chain.client.getBlock({ blockNumber: receipt.blockNumber }), ethUsd()]);
  const logs = receipt.logs;

  // Token metadata for every token that moved.
  const tokens = [...new Set(logs.filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3).map((l) => l.address.toLowerCase()))];
  const meta = Object.fromEntries(await Promise.all(tokens.map(async (t) => [t, await tokenMeta(t, chain)])));
  const sym = (t) => (meta[t]?.symbol ? `$${meta[t].symbol}` : short(t));

  // Curves in this tx: the token whose transfers touch the curve address.
  const launches = logs.filter((l) => l.address.toLowerCase() === FACTORY && l.topics[0] === LAUNCHED);
  const curveToken = new Map(launches.map((l) => [addr(l.topics[2]), addr(l.topics[1])]));
  for (const l of logs) {
    if (l.topics[0] !== TRANSFER || l.topics.length !== 3) continue;
    for (const side of [addr(l.topics[1]), addr(l.topics[2])]) {
      if (logs.some((x) => x.address.toLowerCase() === side && (x.topics[0] === BUY || x.topics[0] === SELL)) && !curveToken.has(side)) {
        curveToken.set(side, l.address.toLowerCase());
      }
    }
  }
  // Contracts we don't already know get their verified name ("PoolManager"), so the summary reads better than a
  // row of short addresses. Only a few are looked up, and a failed lookup just leaves the short address.
  const unknown = new Set();
  const consider = (a) => {
    const k = a?.toLowerCase();
    if (k && !known[k] && !curveToken.has(k) && k !== tx.from.toLowerCase() && !/^0x0{40}$/.test(k)) unknown.add(k);
  };
  consider(tx.to);
  for (const l of logs) if (l.topics[0] === TRANSFER && l.topics.length === 3) for (const side of [addr(l.topics[1]), addr(l.topics[2])]) consider(side);
  const lookedUp = [...unknown].slice(0, NAMES_LOOKED_UP);
  // Base's Blockscout can take seconds to name a contract; there a name that takes over 5 s is left out.
  const nameOf = (a) => (onBase ? Promise.race([contractName(a, chain), new Promise((r) => setTimeout(() => r(null), 5_000))]) : contractName(a, chain));
  const named = new Map((await Promise.all(lookedUp.map(async (a) => [a, await nameOf(a)]))).filter(([, n]) => n));

  const label = (a) => {
    const k = a.toLowerCase();
    if (known[k]) return known[k];
    if (curveToken.has(k)) return `the ${sym(curveToken.get(k))} bonding curve`;
    if (named.has(k)) return `${named.get(k)} (${short(k)})`;
    return short(k);
  };

  const actions = [];
  for (const l of launches) {
    const token = addr(l.topics[1]);
    const m = meta[token] ?? (await tokenMeta(token, chain));
    const creator = addr(l.topics[3]);
    const launcher = creator === tx.to?.toLowerCase() ? `${label(tx.from)} (through a launcher contract)` : label(creator);
    actions.push({ type: "launch", text: `${launcher} launched $${m.symbol ?? "?"}${m.name && m.name !== m.symbol ? ` (${m.name})` : ""} on the Robinhood Chain launchpad.`, token });
  }
  if (onBase) {
    for (const token of tokens) {
      const launch = baseLaunchFromLogs(token, logs);
      if (!launch) continue;
      const m = meta[token];
      actions.push({ type: "launch", text: `${label(launch.creator)} launched $${m?.symbol ?? "?"}${m?.name && m.name !== m.symbol ? ` (${m.name})` : ""} on ${launch.launchpad}.`, token });
    }
  }
  for (const l of logs) {
    const curve = l.address.toLowerCase();
    if (l.topics[0] !== BUY && l.topics[0] !== SELL) continue;
    const token = curveToken.get(curve);
    const d = meta[token]?.decimals ?? 18;
    const w = words(l.data);
    const who = label(addr(l.topics[2]));
    if (l.topics[0] === BUY) {
      actions.push({ type: "buy", text: `${who} bought ${fmt(formatUnits(w[1], d))} ${token ? sym(token) : "tokens"} for ${fmt(formatEther(w[0]))} ETH (~$${usd(Number(formatEther(w[0])) * eth)}).`, token });
    } else {
      actions.push({ type: "sell", text: `${who} sold ${fmt(formatUnits(w[0], d))} ${token ? sym(token) : "tokens"} for ${fmt(formatEther(w[1]))} ETH (~$${usd(Number(formatEther(w[1])) * eth)}).`, token });
    }
  }
  // Plain transfers that aren't part of a curve trade or a mint/burn.
  const transfers = [];
  for (const l of logs) {
    if (l.topics[0] !== TRANSFER || l.topics.length !== 3) continue;
    const token = l.address.toLowerCase();
    const from = addr(l.topics[1]);
    const to = addr(l.topics[2]);
    const amount = formatUnits(BigInt(l.data), meta[token]?.decimals ?? 18);
    transfers.push({ token, symbol: meta[token]?.symbol ?? null, from, to, amount });
    if (curveToken.has(from) || curveToken.has(to)) continue;
    if (from === "0x0000000000000000000000000000000000000000" || to === "0x0000000000000000000000000000000000000000") continue;
    const usdNote = token === USDG || (onBase && token === USDC_BASE) ? ` (~$${usd(Number(amount))})` : "";
    actions.push({ type: "transfer", text: `${label(from)} sent ${fmt(amount)} ${sym(token)}${usdNote} to ${label(to)}.`, token });
  }
  // Base launches: the launch hands its supply to pools, vaults and airdrops in a row of transfers. Said as one line:
  // where the supply ended up, with shares, and what anyone else (a creator's buy) got.
  const launched = new Set(actions.filter((a) => a.type === "launch").map((a) => a.token));
  if (onBase && launched.size) {
    for (const token of launched) {
      const d = meta[token]?.decimals ?? 18;
      const ended = new Map();
      let minted = 0n;
      const passedOn = new Set(); // contracts that handed the supply on (a locker may keep a speck)
      for (const l of logs) {
        if (l.topics[0] !== TRANSFER || l.topics.length !== 3 || l.address.toLowerCase() !== token) continue;
        const [from, to, v] = [addr(l.topics[1]), addr(l.topics[2]), BigInt(l.data)];
        if (/^0x0{40}$/.test(from)) minted += v;
        else {
          ended.set(from, (ended.get(from) ?? 0n) - v);
          passedOn.add(from);
        }
        ended.set(to, (ended.get(to) ?? 0n) + v);
      }
      // Shares of at least 0.01% are where the supply went; smaller amounts are buys made in the launch itself.
      const big = (v) => minted > 0n && v * 10_000n >= minted;
      const parts = [...ended].filter(([, v]) => v > 0n && big(v)).sort((a, b) => (b[1] > a[1] ? 1 : -1));
      const buys = [...ended].filter(([a, v]) => v > 0n && !big(v) && !passedOn.has(a) && !/^0x0{40}$/.test(a));
      const share = (v) => (minted > 0n ? `${(Number((v * 10_000n) / minted) / 100).toFixed(2).replace(/\.?0+$/, "")}%` : `${fmt(formatUnits(v, d))} ${sym(token)}`);
      const listed = parts.slice(0, 5).map(([a, v]) => `${label(a)} (${share(v)})`);
      if (listed.length) actions.push({ type: "supply", text: `Its supply went to ${listed.join(", ")}.`, token });
      for (const [a, v] of buys.slice(0, 5)) actions.push({ type: "buy", text: `${label(a)} got ${fmt(formatUnits(v, d))} ${sym(token)} in the launch transaction (a first buy).`, token });
    }
    // The hops that did it, and the WETH dust of a creator's first buy, stay in `transfers` only.
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.type === "transfer" && (launched.has(a.token) || a.token === WETH_BASE)) actions.splice(i, 1);
    }
  }

  // Base swaps: what the sender gave and got back across all its token moves, said as one line. The pool and router
  // hops in between are left out of the summary (they stay in `transfers`).
  let swapped = false;
  if (onBase) {
    const me = tx.from.toLowerCase();
    const net = new Map();
    for (const t of transfers) {
      const v = parseUnitsSafe(t.amount, meta[t.token]?.decimals ?? 18);
      if (t.from === me) net.set(t.token, (net.get(t.token) ?? 0n) - v);
      if (t.to === me) net.set(t.token, (net.get(t.token) ?? 0n) + v);
    }
    // ETH paid in with the transaction counts as given, as WETH would.
    const gave = [...net].filter(([, v]) => v < 0n);
    const got = [...net].filter(([, v]) => v > 0n);
    if (tx.value > 0n) gave.push(["eth", -tx.value]);
    const amountOf = ([t, v]) => {
      const n = v < 0n ? -v : v;
      if (t === "eth") return `${fmt(formatEther(n))} ETH`;
      const text = `${fmt(formatUnits(n, meta[t]?.decimals ?? 18))} ${sym(t)}`;
      return t === USDC_BASE ? `${text} (~$${usd(Number(formatUnits(n, 6)))})` : t === WETH_BASE ? `${text} (~$${usd(Number(formatEther(n)) * eth)})` : text;
    };
    if (gave.length && got.length && !actions.some((a) => a.type === "launch")) {
      for (let i = actions.length - 1; i >= 0; i--) if (actions[i].type === "transfer") actions.splice(i, 1);
      actions.push({ type: "swap", text: `${label(me)} swapped ${gave.map(amountOf).join(" and ")} for ${got.map(amountOf).join(" and ")}.`, token: got[0][0] });
      swapped = true;
    }
  }
  // Router trades: the sender pays ETH to a router, the router buys on the curve and forwards the tokens back.
  // Say it the way a person would: "<sender> bought … via a router".
  const router = tx.to?.toLowerCase();
  const sender = tx.from.toLowerCase();
  const routed = actions.filter((a) => (a.type === "buy" || a.type === "sell") && router && a.text.startsWith(`${label(router)} `));
  let routedTrade = false;
  for (const a of routed) {
    a.text = a.text.replace(`${label(router)} `, `${label(sender)} `).replace(/\.$/, " via a router.");
    routedTrade = true;
  }
  if (routedTrade) {
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.type === "transfer" && (a.text.startsWith(`${label(router)} sent`) && a.text.endsWith(`to ${label(sender)}.`))) actions.splice(i, 1);
    }
  }
  if (tx.value > 0n && !routedTrade && !swapped) actions.unshift({ type: "eth", text: `${label(tx.from)} sent ${fmt(formatEther(tx.value))} ETH (~$${usd(Number(formatEther(tx.value)) * eth)}) to ${tx.to ? label(tx.to) : "a new contract"}.` });
  if (!actions.length) actions.push({ type: "call", text: `${label(tx.from)} called ${tx.to ? label(tx.to) : "a new contract"} with no token or ETH movement.` });

  // On Base the fee also covers posting the transaction to Ethereum (l1Fee).
  const feeWei = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n) + (receipt.l1Fee ?? 0n);
  const failed = receipt.status !== "success";
  // Keep the summary readable: many buys of one token in a single tx (a bundled launch) become one line.
  const lines = [];
  const buysByToken = new Map();
  for (const a of actions) if (a.type === "buy" && a.token) buysByToken.set(a.token, [...(buysByToken.get(a.token) ?? []), a]);
  const bundled = new Set([...buysByToken].filter(([, list]) => list.length > 3).map(([t]) => t));
  for (const a of actions) {
    if (a.type === "buy" && bundled.has(a.token)) {
      if (a !== buysByToken.get(a.token)[0]) continue;
      const list = buysByToken.get(a.token);
      const ethTotal = logs
        .filter((l) => (l.topics[0] === BUY) && curveToken.get(l.address.toLowerCase()) === a.token)
        .reduce((sum, l) => sum + words(l.data)[0], 0n);
      lines.push(`${list.length} wallets bought ${sym(a.token)} in this same transaction for ${fmt(formatEther(ethTotal))} ETH in total (~$${usd(Number(formatEther(ethTotal)) * eth)}), a bundled buy.`);
      continue;
    }
    if (a.type === "transfer" && bundled.has(a.token)) continue;
    lines.push(a.text);
  }
  const summary = failed ? `This transaction failed and changed nothing. ${actions[0].text}` : lines.join(" ");
  return {
    hash: tx.hash,
    chain: chain.name,
    status: failed ? "failed" : "success",
    summary,
    actions,
    from: tx.from.toLowerCase(),
    to: tx.to?.toLowerCase() ?? null,
    valueEth: Number(formatEther(tx.value)),
    feeEth: Number(formatEther(feeWei)),
    feeUsd: Number(formatEther(feeWei)) * eth,
    time: new Date(Number(block.timestamp) * 1000).toISOString(),
    block: Number(receipt.blockNumber),
    transfers,
    contracts: [...named].map(([address, name]) => ({ address, name })),
    explorer: `${chain.explorer}/tx/${tx.hash}`,
  };
}
