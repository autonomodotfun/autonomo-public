// Official Autonomo API: did a payment really settle on Robinhood Chain, and was it what was asked for?
//
// GET /v1/payment/<transaction hash>?to=<address>&amount=<number>&asset=usdg|autonomo
//   (header: x-api-key: <TOOLS_API_KEY>)
//
// Reads the transaction and reports every USDG and $AUTONOMO payment in it: who paid, who was paid, how much, how it
// was settled (an x402 authorization submitted by someone else, or a plain transfer) and who paid the gas. When the
// payee is one of Autonomo's burn splitters, it names the wallet behind it and the share that is burned.
//
// With `to`, `amount` or `asset`, it also answers yes or no: does a payment in this transaction match? `to` matches
// the address that was paid or, for a splitter, the wallet behind it. An agent or a seller can use that to check a
// receipt without trusting whoever sent it. Everything is read from the chain.

import { formatUnits, isAddress, parseAbi, parseUnits } from "viem";
import { addr, authorized, AUTONOMO, EXPLORER, rh, sendJson, tokenMeta, TRANSFER, USDG } from "./_lib.js";

const FACILITATOR = "0x68aa21699247a5f0b90661c50004e426507fe9f8"; // submits Autonomo's gateway payments and pays their gas
const X402_PERMIT2_PROXY = "0x402085c248eea27d92e8b30b2c58ed07f9e20001";
const ASSETS = { usdg: USDG, autonomo: AUTONOMO };
const splitterAbi = parseAbi(["function recipient() view returns (address)", "function BURN_BPS() view returns (uint256)"]);
const cache = new Map(); // hash -> what the chain says, which never changes once mined
const splitters = new Map();

/** How the transaction moved the money, from what it called. */
function methodOf(tx) {
  const to = tx.to?.toLowerCase();
  const selector = tx.input.slice(0, 10);
  if (to === X402_PERMIT2_PROXY) return { kind: "x402-permit2", text: "An x402 payment through Permit2: the payer signed, and someone else submitted it" };
  if (selector === "0xe3ee160e" || selector === "0xcf092995") return { kind: "x402-authorization", text: "An x402 payment by signed authorization: the payer signed, and someone else submitted it" };
  if (selector === "0xa9059cbb") return { kind: "transfer", text: "A plain token transfer sent by the payer, not an x402 settlement" };
  return { kind: "other", text: "The payment happened inside a larger transaction" };
}

/** If the payee is a burn splitter, the wallet behind it and the share burned; otherwise null. */
async function splitterOf(address) {
  if (splitters.has(address)) return splitters.get(address);
  const [recipient, bps] = await Promise.all([
    rh.readContract({ address, abi: splitterAbi, functionName: "recipient" }).catch(() => null),
    rh.readContract({ address, abi: splitterAbi, functionName: "BURN_BPS" }).catch(() => null),
  ]);
  const found = recipient && bps !== null ? { recipient: recipient.toLowerCase(), burnPercent: Number(bps) / 100 } : null;
  if (splitters.size > 5000) splitters.clear();
  splitters.set(address, found);
  return found;
}

async function read(hash) {
  if (cache.has(hash)) return cache.get(hash);
  const [tx, receipt] = await Promise.all([
    rh.getTransaction({ hash }).catch(() => null),
    rh.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx || !receipt) return null;
  const [block, latest] = await Promise.all([rh.getBlock({ blockNumber: receipt.blockNumber }), rh.getBlockNumber()]);

  const payments = [];
  for (const l of receipt.logs) {
    const token = l.address.toLowerCase();
    if (l.topics[0] !== TRANSFER || l.topics.length !== 3 || (token !== USDG && token !== AUTONOMO)) continue;
    const to = addr(l.topics[2]);
    // A mint or a burn moves tokens, but nobody paid anybody.
    if (/^0x0{40}$/.test(addr(l.topics[1])) || /^0x0{40}$/.test(to)) continue;
    const meta = await tokenMeta(token);
    const raw = BigInt(l.data);
    payments.push({
      asset: token === USDG ? "USDG" : "$AUTONOMO",
      token,
      amount: Number(formatUnits(raw, meta.decimals)),
      amountRaw: raw.toString(),
      from: addr(l.topics[1]),
      to,
      splitter: await splitterOf(to),
    });
  }
  const sender = tx.from.toLowerCase();
  const body = {
    hash,
    chain: "Robinhood Chain",
    status: receipt.status === "success" ? "success" : "failed",
    // paid: USDG or $AUTONOMO changed hands. x402Settlement: it did so as an x402 payment, not a trade or a plain send.
    paid: receipt.status === "success" && payments.length > 0,
    x402Settlement: receipt.status === "success" && payments.length > 0 && methodOf(tx).kind.startsWith("x402"),
    time: new Date(Number(block.timestamp) * 1000).toISOString(),
    block: Number(receipt.blockNumber),
    confirmations: Number(latest - receipt.blockNumber) + 1,
    method: methodOf(tx),
    submittedBy: sender,
    submittedByAutonomo: sender === FACILITATOR,
    feeEth: Number(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)) / 1e18,
    payments,
    explorer: `${EXPLORER}/tx/${hash}`,
  };
  cache.set(hash, body);
  if (cache.size > 2000) cache.clear();
  return body;
}

/** Does any payment match what the caller expected? Returns null when nothing was asked. */
function match(payments, want) {
  if (!want.to && want.amount === null && !want.token) return null;
  const reasons = [];
  const hit = payments.find((p) => {
    if (want.token && p.token !== want.token) return false;
    if (want.to && p.to !== want.to && p.splitter?.recipient !== want.to) return false;
    if (want.amount !== null && parseUnits(want.amount, p.token === USDG ? 6 : 18) !== BigInt(p.amountRaw)) return false;
    return true;
  });
  if (!hit) {
    if (!payments.length) reasons.push("No USDG or $AUTONOMO moved in this transaction");
    else {
      if (want.token && !payments.some((p) => p.token === want.token)) reasons.push("No payment in the asset you asked for");
      if (want.to && !payments.some((p) => p.to === want.to || p.splitter?.recipient === want.to)) reasons.push("No payment to the address you asked for");
      if (want.amount !== null) reasons.push(`No payment of exactly ${want.amount}${reasons.length ? "" : " to that address in that asset"}`);
    }
  }
  return { matches: Boolean(hit), payment: hit ?? null, reasons };
}

function sentence(body, check) {
  if (body.status === "failed") return "This transaction failed, so nothing was paid.";
  if (!body.payments.length) return "This transaction succeeded but moved no USDG or $AUTONOMO, so it isn't a payment in either.";
  const p = check?.payment ?? body.payments[0];
  const where = p.splitter ? `a burn splitter for ${p.splitter.recipient} (${p.splitter.burnPercent}% is burned, the rest goes to that wallet)` : p.to;
  const who = body.submittedByAutonomo ? "Autonomo's facilitator submitted it and paid the gas" : body.submittedBy === p.from ? "the payer sent it and paid the gas" : `${body.submittedBy} submitted it and paid the gas`;
  const verdict = check ? (check.matches ? " It matches what you asked for." : ` It does not match what you asked for: ${check.reasons.join("; ")}.`) : "";
  // Only an x402 settlement is called one; a trade or a plain send that moved the same tokens is named as that.
  const lead = body.method.kind.startsWith("x402") ? "Settled" : body.method.kind === "transfer" ? "A plain transfer, not an x402 settlement" : "Not an x402 settlement, but tokens moved inside a larger transaction";
  return `${lead}: ${p.from} paid ${p.amount} ${p.asset} to ${where}; ${who}.${body.payments.length > 1 ? ` The transaction has ${body.payments.length} payments in all.` : ""}${verdict}`;
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const hash = String(req.query.hash ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return sendJson(res, 400, { error: "bad_hash", message: "Pass a transaction hash: /v1/payment/0x…" });

  const to = String(req.query.to ?? "").trim().toLowerCase();
  const amount = String(req.query.amount ?? "").trim();
  const asset = String(req.query.asset ?? "").trim().toLowerCase().replace(/^\$/, "");
  if (to && !isAddress(to)) return sendJson(res, 400, { error: "bad_to", message: "`to` must be an address." });
  if (amount && !/^\d+(\.\d{1,18})?$/.test(amount)) return sendJson(res, 400, { error: "bad_amount", message: "`amount` must be a plain number, such as 0.01." });
  if (asset && !ASSETS[asset]) return sendJson(res, 400, { error: "bad_asset", message: "`asset` must be usdg or autonomo." });
  if (amount && asset !== "autonomo" && !/^\d+(\.\d{1,6})?$/.test(amount)) return sendJson(res, 400, { error: "bad_amount", message: "A USDG amount has at most 6 decimals. Add asset=autonomo for an $AUTONOMO amount." });

  try {
    const body = await read(hash);
    if (!body) return sendJson(res, 404, { error: "not_found", message: "No such transaction on Robinhood Chain (or it isn't mined yet)." });
    // An amount with no asset is read as USDG, the usual x402 price.
    const check = match(body.payments, { to: to || null, amount: amount || null, token: asset ? ASSETS[asset] : amount ? USDG : null });
    return sendJson(res, 200, {
      ...body,
      confirmations: Number((await rh.getBlockNumber().catch(() => BigInt(body.block))) - BigInt(body.block)) + 1,
      summary: sentence(body, check),
      ...(check ? { check: { asked: { to: to || null, amount: amount || null, asset: asset || (amount ? "usdg" : null) }, matches: check.matches, reasons: check.reasons } } : {}),
    });
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "upstream_error", message: "Couldn't read the chain right now. Try again." });
  }
}
