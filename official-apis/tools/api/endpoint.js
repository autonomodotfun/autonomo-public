// Official Autonomo API: is an x402 API up, and can it actually be paid right now?
//
// GET /v1/endpoint?url=https://…&method=GET|POST   (header: x-api-key: <TOOLS_API_KEY>)
//
// Calls the address once without paying, the way any agent's first request does, and reads the answer. A working
// x402 API answers HTTP 402 with what it accepts: in the PAYMENT-REQUIRED header (x402 version 2) or in the body
// (version 1). This reports whether it answered, how fast, and whether each payment option is complete enough for a
// client to pay: the scheme, the network, the asset, the amount and who gets paid.
//
// It never pays, so it can't tell whether the API delivers after payment: only that the door is open and the price
// tag is readable. Addresses must be https and public.

import { authorized, AUTONOMO, sendJson, USDG } from "./_lib.js";
import { fetchOnce } from "./_net.js";

const NETWORKS = {
  "eip155:4663": "Robinhood Chain",
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia (testnet)",
  "eip155:137": "Polygon",
  "eip155:42161": "Arbitrum",
  "eip155:1": "Ethereum",
  base: "Base",
  "base-sepolia": "Base Sepolia (testnet)",
  polygon: "Polygon",
  solana: "Solana",
};
const cache = new Map(); // method + url -> { at, body }
const CACHE_MS = 20_000;

const decodeHeader = (value) => {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
};
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** One payment option, checked: what it asks for in plain terms, and what is missing for a client to pay it. */
export function readOption(o) {
  const problems = [];
  const amount = o?.amount ?? o?.maxAmountRequired;
  if (!o || typeof o !== "object") return { problems: ["Not a payment option"] };
  if (!o.scheme) problems.push("No scheme");
  if (!o.network) problems.push("No network");
  if (!o.asset) problems.push("No asset");
  if (!o.payTo) problems.push("No address to pay");
  if (amount === undefined || !/^\d+$/.test(String(amount))) problems.push("The amount isn't a whole number of the asset's smallest unit");
  else if (BigInt(amount) === 0n) problems.push("The amount is zero");

  // A human price only where the asset's decimals are known: the two Robinhood Chain coins, and dollar stablecoins,
  // which use 6.
  const asset = String(o.asset ?? "").toLowerCase();
  const dollar = asset === USDG || /usd|dollar/i.test(String(o.extra?.name ?? ""));
  let price = null;
  if (/^\d+$/.test(String(amount ?? ""))) {
    if (asset === AUTONOMO) price = { amount: Number(amount) / 1e18, unit: "$AUTONOMO" };
    else if (dollar) price = { amount: Number(amount) / 1e6, unit: "USD" };
  }
  return {
    scheme: o.scheme ?? null,
    network: o.network ?? null,
    networkName: NETWORKS[String(o.network ?? "").toLowerCase()] ?? null,
    asset: o.asset ?? null,
    assetName: o.extra?.name ?? (asset === AUTONOMO ? "Autonomo" : null),
    amount: amount === undefined ? null : String(amount),
    price,
    payTo: o.payTo ?? null,
    payable: problems.length === 0,
    problems,
  };
}

async function check(url, method) {
  const r = await fetchOnce(url, {
    method,
    headers: { accept: "application/json", "user-agent": "AutonomoEndpointHealth/1.0 (+https://autonomo.fun)", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    body: method === "POST" ? "{}" : undefined,
  });
  if (r.unresolved) {
    return { status: 200, body: { url, method, checkedAt: new Date().toISOString(), verdict: "down", up: false, payable: false, httpStatus: null, ms: null, summary: "Down: the host doesn't exist, nothing answers at that name.", options: [], problems: ["The host doesn't resolve to any address"] } };
  }
  if (r.error) return { status: 400, body: { error: "bad_url", message: r.error } };

  const base = { url: r.url?.href ?? url, method, checkedAt: new Date().toISOString() };
  if (r.failed) {
    return { status: 200, body: { ...base, verdict: "down", up: false, payable: false, httpStatus: null, ms: r.ms, summary: `Down: ${r.failed.toLowerCase()}.`, options: [], problems: [r.failed] } };
  }

  const header = r.headers.get("payment-required");
  const fromHeader = header ? decodeHeader(header) : null;
  const fromBody = parseJson(r.text);
  const requirements = fromHeader?.accepts ? fromHeader : fromBody?.accepts ? fromBody : null;
  const options = Array.isArray(requirements?.accepts) ? requirements.accepts.map(readOption) : [];
  const payable = r.status === 402 && options.some((o) => o.payable);
  const problems = [];
  let verdict;
  let summary;

  if (r.status >= 500) {
    verdict = "down";
    summary = `Down: it answered ${r.status}, an error on its own side.`;
    problems.push(`Server error ${r.status}`);
  } else if (r.status === 402) {
    if (header && !fromHeader) problems.push("The PAYMENT-REQUIRED header isn't readable (it should be base64 JSON)");
    if (!requirements) problems.push("It answered 402 but didn't say what it accepts, in the header or the body");
    else if (!options.length) problems.push("The list of payment options is empty");
    for (const [i, o] of options.entries()) for (const p of o.problems) problems.push(`Option ${i + 1}: ${p}`);
    verdict = payable ? "healthy" : "not_payable";
    const first = options.find((o) => o.payable);
    const priced = first?.price ? `${first.price.amount} ${first.price.unit}` : first ? `${first.amount} of ${first.assetName ?? first.asset}` : null;
    summary = payable
      ? `Healthy: answered in ${r.ms} ms with a payment request a client can pay, ${priced} on ${first.networkName ?? first.network}${options.length > 1 ? `, with ${options.length} options in all` : ""}.`
      : "Up, but it can't be paid: it answered 402 without a complete payment request.";
  } else if (r.status >= 300 && r.status < 400) {
    verdict = "not_x402";
    summary = `It redirects to ${r.headers.get("location") ?? "another address"} instead of asking for payment. Check that address instead.`;
    problems.push(`Redirect (${r.status})`);
  } else if (r.status >= 200 && r.status < 300) {
    verdict = "not_x402";
    summary = "Up, but it answered without asking for payment, so this address is free or isn't the paid one.";
    problems.push("No payment was asked for");
  } else {
    verdict = "not_x402";
    summary = `It answered ${r.status} instead of a payment request${r.status === 404 ? ": nothing is at this address" : r.status === 405 ? ": try the other method (GET or POST)" : ""}.`;
    problems.push(`Answered ${r.status}, not 402`);
  }

  return {
    status: 200,
    body: {
      ...base,
      verdict,
      up: r.status < 500,
      payable,
      httpStatus: r.status,
      ms: r.ms,
      summary,
      x402Version: requirements?.x402Version ?? null,
      requestIn: fromHeader?.accepts ? "PAYMENT-REQUIRED header" : requirements ? "response body" : null,
      description: requirements?.resource?.description ?? requirements?.accepts?.[0]?.description ?? null,
      options,
      problems,
      note: "Checked without paying: this shows the API is up and its price can be read, not that it delivers after payment.",
    },
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const url = String(req.query.url ?? "").trim();
  const method = String(req.query.method ?? "GET").trim().toUpperCase();
  if (!url) return sendJson(res, 400, { error: "bad_url", message: "Pass the API's address: /v1/endpoint?url=https://…" });
  if (url.length > 2000) return sendJson(res, 400, { error: "bad_url", message: "That address is too long." });
  if (method !== "GET" && method !== "POST") return sendJson(res, 400, { error: "bad_method", message: "`method` must be GET or POST." });
  try {
    const key = `${method} ${url}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return sendJson(res, hit.status, hit.body);
    const result = await check(url, method);
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), ...result });
    return sendJson(res, result.status, result.body);
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "check_failed", message: "Couldn't run the check right now. Try again." });
  }
}
