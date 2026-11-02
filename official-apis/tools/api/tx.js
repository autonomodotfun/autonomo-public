// GET /v1/tx/<transaction hash>  (header: x-api-key)
// Explains a Robinhood Chain transaction in plain English: launches, bonding curve buys and sells, token
// transfers and ETH sent, with amounts, symbols and the fee.

import { formatEther, formatUnits } from "viem";
import { addr, authorized, BUY, ethUsd, EXPLORER, FACTORY, LAUNCHED, rh, SELL, sendJson, short, tokenMeta, TRANSFER, USDG, words } from "./_lib.js";

const KNOWN = {
  [FACTORY]: "the launchpad",
  "0x267444d099b10fb5ed7c3cc7b7c767adca574952": "the launchpad's liquidity locker",
  "0x402085c248eea27d92e8b30b2c58ed07f9e20001": "the x402 Permit2 proxy",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Permit2",
};
const cache = new Map();

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const hash = String(req.query.hash ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return sendJson(res, 400, { error: "bad_hash", message: "Pass a transaction hash: /v1/tx/0x…" });

  if (cache.has(hash)) return sendJson(res, 200, cache.get(hash));
  try {
    const [tx, receipt] = await Promise.all([
      rh.getTransaction({ hash }).catch(() => null),
      rh.getTransactionReceipt({ hash }).catch(() => null),
    ]);
    if (!tx || !receipt) return sendJson(res, 404, { error: "not_found", message: "No such transaction on Robinhood Chain (or it isn't mined yet)." });
    const body = await explain(tx, receipt);
    cache.set(hash, body); // mined transactions never change
    if (cache.size > 2000) cache.clear();
    return sendJson(res, 200, body);
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
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

async function explain(tx, receipt) {
  const [block, eth] = await Promise.all([rh.getBlock({ blockNumber: receipt.blockNumber }), ethUsd()]);
  const logs = receipt.logs;

  // Token metadata for every token that moved.
  const tokens = [...new Set(logs.filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3).map((l) => l.address.toLowerCase()))];
  const meta = Object.fromEntries(await Promise.all(tokens.map(async (t) => [t, await tokenMeta(t)])));
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
  const label = (a) => {
    const k = a.toLowerCase();
    if (KNOWN[k]) return KNOWN[k];
    if (curveToken.has(k)) return `the ${sym(curveToken.get(k))} bonding curve`;
    return short(k);
  };

  const actions = [];
  for (const l of launches) {
    const token = addr(l.topics[1]);
    const m = meta[token] ?? (await tokenMeta(token));
    const creator = addr(l.topics[3]);
    const launcher = creator === tx.to?.toLowerCase() ? `${label(tx.from)} (through a launcher contract)` : label(creator);
    actions.push({ type: "launch", text: `${launcher} launched $${m.symbol ?? "?"}${m.name && m.name !== m.symbol ? ` (${m.name})` : ""} on the Robinhood Chain launchpad.`, token });
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
    const usdNote = token === USDG ? ` (~$${usd(Number(amount))})` : "";
    actions.push({ type: "transfer", text: `${label(from)} sent ${fmt(amount)} ${sym(token)}${usdNote} to ${label(to)}.`, token });
  }
  // Router trades: the sender pays ETH to a router, the router buys on the curve and forwards the tokens back.
  // Say it the way a person would: "<sender> bought … via a router".
  const router = tx.to?.toLowerCase();
  const sender = tx.from.toLowerCase();
  const routed = actions.filter((a) => (a.type === "buy" || a.type === "sell") && router && a.text.startsWith(`${short(router)} `));
  let routedTrade = false;
  for (const a of routed) {
    a.text = a.text.replace(`${short(router)} `, `${label(sender)} `).replace(/\.$/, " via a router.");
    routedTrade = true;
  }
  if (routedTrade) {
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.type === "transfer" && (a.text.startsWith(`${short(router)} sent`) && a.text.endsWith(`to ${label(sender)}.`))) actions.splice(i, 1);
    }
  }
  if (tx.value > 0n && !routedTrade) actions.unshift({ type: "eth", text: `${label(tx.from)} sent ${fmt(formatEther(tx.value))} ETH (~$${usd(Number(formatEther(tx.value)) * eth)}) to ${tx.to ? label(tx.to) : "a new contract"}.` });
  if (!actions.length) actions.push({ type: "call", text: `${label(tx.from)} called ${tx.to ? label(tx.to) : "a new contract"} with no token or ETH movement.` });

  const feeWei = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
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
    chain: "Robinhood Chain",
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
    explorer: `${EXPLORER}/tx/${tx.hash}`,
  };
}
