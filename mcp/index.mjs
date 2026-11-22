#!/usr/bin/env node
// Autonomo MCP server: lets Claude, Codex, Cursor and other MCP clients find Autonomo x402 APIs, check the price
// and pay per call in USDG or $AUTONOMO on Robinhood Chain, or USDC on Base, from a wallet the user controls.
//
// Tools: find_apis (free), get_price (free), wallet_status (free), call_api (pays). Runs locally over stdio, so the wallet key never
// leaves this machine except as signed payments. Settings come from env vars (see README.md). Never write to
// stdout here: it carries the MCP protocol, so logs go to stderr.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, maxUint256, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { z } from "zod";

const VERSION = "0.1.3";
const BASE = (process.env.AUTONOMO_BASE_URL || "https://autonomo.fun").replace(/\/+$/, "");
const NETWORK = "eip155:4663";
const RPC = process.env.AUTONOMO_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const BASE_NETWORK = "eip155:8453";
const BASE_RPC = process.env.AUTONOMO_BASE_RPC_URL || "https://mainnet.base.org";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// The tokens this server pays with, each with a hard cap per call and a daily budget (env overrides). USDG and USDC on
// Base are both dollars, so they share one cap and one daily budget (AUTONOMO_DAILY_USDG); `budget` names it.
/** An amount from an env var, in whole tokens. A value that isn't a plain number is ignored, with a note on stderr. */
function amountEnv(name, fallback, decimals) {
  const raw = process.env[name]?.trim();
  if (!raw) return parseUnits(fallback, decimals);
  if (/^\d+(\.\d+)?$/.test(raw)) return parseUnits(raw, decimals);
  console.error(`${name} should be a number such as ${fallback}; using ${fallback}.`);
  return parseUnits(fallback, decimals);
}
const USD_DAILY = amountEnv("AUTONOMO_DAILY_USDG", "1", 6);
const USD_CAP = amountEnv("AUTONOMO_MAX_USDG_PER_CALL", "0.05", 6);
const TOKENS = {
  usdg: {
    symbol: "USDG",
    label: "USDG",
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    decimals: 6,
    network: NETWORK,
    chain: "Robinhood Chain",
    explorer: EXPLORER,
    budget: "usd",
    cap: USD_CAP,
    daily: USD_DAILY,
  },
  autonomo: {
    symbol: "AUTONOMO",
    label: "AUTONOMO",
    address: "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96",
    decimals: 18,
    network: NETWORK,
    chain: "Robinhood Chain",
    explorer: EXPLORER,
    budget: "autonomo",
    cap: amountEnv("AUTONOMO_MAX_AUTONOMO_PER_CALL", "5000", 18),
    daily: amountEnv("AUTONOMO_DAILY_AUTONOMO", "10000", 18),
  },
  usdc: {
    symbol: "USDC",
    label: "USDC on Base",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    network: BASE_NETWORK,
    chain: "Base",
    explorer: "https://basescan.org",
    budget: "usd",
    cap: USD_CAP,
    daily: USD_DAILY,
  },
};
// The order "auto" tries them in.
const PAY_CHOICES = ["usdg", "autonomo", "usdc"];
const PAY_LABEL = { usdg: "USDG", autonomo: "AUTONOMO", usdc: "USDC on Base", auto: "auto: USDG, then AUTONOMO, then USDC on Base, whichever the wallet can pay with" };
const PAY_ENV = (process.env.AUTONOMO_PAY_WITH || "").trim().toLowerCase();
if (PAY_ENV && !Object.hasOwn(PAY_LABEL, PAY_ENV)) console.error("AUTONOMO_PAY_WITH should be auto, usdg, autonomo or usdc; using auto.");
const DEFAULT_PAY = Object.hasOwn(PAY_LABEL, PAY_ENV) ? PAY_ENV : "auto";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

class Stop extends Error {}
const fail = (message) => {
  throw new Stop(message);
};
const decode = (h) => (h ? JSON.parse(Buffer.from(h, "base64").toString("utf8")) : null);
const tokenOf = (asset, network) =>
  Object.values(TOKENS).find((t) => t.address.toLowerCase() === String(asset).toLowerCase() && (network === undefined || t.network === network));

// ---------- Daily budget, kept in ~/.autonomo-mcp/spend.json (base units per token, reset each UTC day) ----------
// USDG and USDC are kept apart in the file but count against one dollar budget.

const SPEND_FILE = join(homedir(), ".autonomo-mcp", "spend.json");
const today = () => new Date().toISOString().slice(0, 10);

function spentToday() {
  try {
    const s = JSON.parse(readFileSync(SPEND_FILE, "utf8"));
    if (s.date === today()) return { usdg: BigInt(s.usdg ?? 0), autonomo: BigInt(s.autonomo ?? 0), usdc: BigInt(s.usdc ?? 0) };
  } catch {
    // No file yet, or unreadable: nothing spent today.
  }
  return { usdg: 0n, autonomo: 0n, usdc: 0n };
}

/** What counts against a token's budget today: dollars (USDG and USDC together) or $AUTONOMO. */
function spentOnBudget(pay) {
  const s = spentToday();
  return TOKENS[pay].budget === "usd" ? s.usdg + s.usdc : s.autonomo;
}

function recordSpend(pay, amount) {
  const s = spentToday();
  s[pay] += amount;
  mkdirSync(join(homedir(), ".autonomo-mcp"), { recursive: true });
  writeFileSync(SPEND_FILE, JSON.stringify({ date: today(), usdg: s.usdg.toString(), autonomo: s.autonomo.toString(), usdc: s.usdc.toString() }));
}

// ---------- Gateways ----------

const UPDATING = "Autonomo is being updated right now. Please check back later.";

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 503) fail(UPDATING);
  if (!res.ok) fail(`${new URL(url).pathname} answered ${res.status}.`);
  return res.json();
}

/** Only Autonomo gateway URLs: https://autonomo.fun/x/<slug><path>, nothing that escapes /x/<slug>. */
function gatewayUrl(slug, path = "/") {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) fail("slug should look like token-risk (lowercase letters, numbers, dashes).");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (p.includes("..") || p.startsWith("//") || /[\s\\]/.test(p)) fail("path must be a plain path such as /risk/0x….");
  const url = new URL(`${BASE}/x/${slug}${p}`);
  if (url.origin !== new URL(BASE).origin || !(url.pathname === `/x/${slug}` || url.pathname.startsWith(`/x/${slug}/`))) {
    fail("That path leaves the gateway.");
  }
  return url.toString();
}

/** The 402 price list for a gateway call, without paying. */
async function quote(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  let required = decode(res.headers.get("payment-required"));
  if (!required && res.status === 402) {
    try {
      required = JSON.parse(await res.text());
    } catch {
      required = null;
    }
  } else {
    await res.body?.cancel();
  }
  if (res.status === 503 && res.headers.get("retry-after")) fail(UPDATING);
  if (res.status !== 402 || !Array.isArray(required?.accepts)) fail(`Expected a 402 price list, got ${res.status}.`);
  return required;
}

function offersFrom(required) {
  return required.accepts.map((a) => {
    const t = tokenOf(a.asset, a.network);
    return { token: t?.label ?? a.asset, amount: formatUnits(BigInt(a.amount), t?.decimals ?? 18), network: a.network, payTo: a.payTo };
  });
}

// ---------- Paying ----------

function walletKey() {
  const key = process.env.AUTONOMO_WALLET_KEY?.trim();
  if (!key) {
    fail("No wallet set. Add AUTONOMO_WALLET_KEY (a dedicated wallet with a little USDG or $AUTONOMO on Robinhood Chain, or USDC on Base) to this server's env in your MCP config.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("AUTONOMO_WALLET_KEY should be 0x followed by 64 hex characters.");
  return key;
}

function clients() {
  return { pub: createPublicClient({ chain: robinhood, transport: http(RPC) }), basePub: createPublicClient({ chain: base, transport: http(BASE_RPC) }) };
}

/**
 * Whether one token can pay this price list right now: the API takes it, the price is within the cap and today's
 * budget, and the wallet holds enough. Returns what to pay, or `why` it can't. Nothing is signed here.
 */
async function check(name, required, account, { pub, basePub }) {
  const token = TOKENS[name];
  const usd = token.budget === "usd";
  const choice = required.accepts.find((a) => a.scheme === "exact" && a.network === token.network && a.asset.toLowerCase() === token.address.toLowerCase());
  if (!choice) return { why: `This API doesn't accept ${token.label}. It accepts: ${offersFrom(required).map((o) => `${o.amount} ${o.token}`).join(", ")}.` };
  const amount = BigInt(choice.amount);
  const price = `${formatUnits(amount, token.decimals)} ${token.label}`;
  if (amount > token.cap) {
    return { why: `The price (${price}) is above this server's cap of ${formatUnits(token.cap, token.decimals)} ${usd ? "USDG/USDC" : token.symbol} per call.` };
  }
  const spent = spentOnBudget(name);
  if (spent + amount > token.daily) {
    return {
      why:
        `Daily budget reached: ${formatUnits(spent, token.decimals)} of ${formatUnits(token.daily, token.decimals)} ${usd ? "dollars (USDG and USDC)" : token.symbol} spent today (UTC). ` +
        `Raise AUTONOMO_DAILY_${usd ? "USDG" : "AUTONOMO"} to allow more.`,
    };
  }
  const chainPub = token.network === BASE_NETWORK ? basePub : pub;
  const balance = await chainPub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance < amount) return { why: `Not enough ${token.label}: the wallet ${account.address} has ${formatUnits(balance, token.decimals)}, the call costs ${price}.` };
  return { name, token, choice, amount, price };
}

async function pay(url, payWith) {
  const account = privateKeyToAccount(walletKey());
  const both = clients();
  const { pub, basePub } = both;
  const required = await quote(url);

  // "auto" takes the first token that can pay, in this order; a named token is that one or nothing.
  const order = payWith === "auto" ? PAY_CHOICES : [payWith];
  const whys = [];
  let picked = null;
  for (const name of order) {
    const r = await check(name, required, account, both);
    if (!r.why) {
      picked = r;
      break;
    }
    whys.push(order.length > 1 ? `${TOKENS[name].label}: ${r.why}` : r.why);
  }
  if (!picked) fail(order.length > 1 ? `No token could pay for this call. ${whys.join(" ")}` : whys[0]);
  const { name, token, choice, amount } = picked;
  const usd = token.budget === "usd";

  // $AUTONOMO is paid through Permit2: one approval transaction the first time (needs a little ETH for gas).
  let approveTx = null;
  if (choice.extra?.assetTransferMethod === "permit2") {
    if (token.network !== NETWORK) fail("A Permit2 payment is only expected on Robinhood Chain.");
    const allowance = await pub.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
    if (allowance < amount) {
      const wallet = createWalletClient({ account, chain: robinhood, transport: http(RPC) });
      approveTx = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
      await pub.waitForTransactionReceipt({ hash: approveTx });
    }
  }

  // Only what was quoted and checked above is ever signed: the same token on the same chain, the same amount and the
  // same payee. If the API's second price list differs, nothing is signed.
  const client = x402Client.fromConfig({
    schemes: [
      token.network === BASE_NETWORK
        ? { network: BASE_NETWORK, client: new ExactEvmScheme(toClientEvmSigner(account, basePub), { rpcUrl: BASE_RPC }) }
        : { network: NETWORK, client: new ExactEvmScheme(toClientEvmSigner(account, pub), { rpcUrl: RPC }) },
    ],
    spendControls: {
      allowedAssets: [{ network: token.network, asset: token.address, maxAmountPerPayment: token.cap.toString() }],
      maxAmountPerPayment: false,
    },
    paymentRequirementsSelector: (_v, reqs) =>
      reqs.find(
        (r) =>
          r.network === token.network &&
          r.asset.toLowerCase() === token.address.toLowerCase() &&
          String(r.amount) === String(choice.amount) &&
          r.payTo.toLowerCase() === choice.payTo.toLowerCase(),
      ) ?? fail("The price or payee changed after it was checked, so nothing was paid. Check the price again."),
  });
  const res = await wrapFetchWithPayment(fetch, client)(url, { signal: AbortSignal.timeout(60_000) });
  if (res.status !== 200) {
    const reason = decode(res.headers.get("payment-required"))?.error;
    fail(reason ? `Payment rejected: ${reason}` : `The API answered ${res.status} after payment (you weren't charged if it didn't settle).`);
  }
  const settlement = decode(res.headers.get("payment-response"));
  const tx = settlement?.transaction ?? null;
  recordSpend(name, amount);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 20_000);
  }
  return {
    paid: { amount: formatUnits(amount, token.decimals), token: token.label, chain: token.chain, from: account.address, to: choice.payTo },
    tx: tx ? `${token.explorer}/tx/${tx}` : null,
    approveTx: approveTx ? `${EXPLORER}/tx/${approveTx}` : null,
    spentToday: `${formatUnits(spentOnBudget(name), token.decimals)} of ${formatUnits(token.daily, token.decimals)} ${usd ? "dollars (USDG and USDC)" : token.symbol}`,
    data,
  };
}

/** The wallet's balances on both chains, today's spending and the limits. Reads only. */
async function walletStatus() {
  const account = privateKeyToAccount(walletKey());
  const { pub, basePub } = clients();
  const held = (client, token) => client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const [robinhoodChain, baseChain] = await Promise.all([
    Promise.all([held(pub, TOKENS.usdg), held(pub, TOKENS.autonomo), pub.getBalance({ address: account.address })])
      .then(([usdg, autonomo, eth]) => ({ usdg: formatUnits(usdg, 6), autonomo: formatUnits(autonomo, 18), eth: formatUnits(eth, 18) }))
      .catch(() => null),
    held(basePub, TOKENS.usdc)
      .then((usdc) => ({ usdc: formatUnits(usdc, 6) }))
      .catch(() => null),
  ]);
  const s = spentToday();
  return {
    wallet: account.address,
    robinhoodChain: robinhoodChain ?? "couldn't be read just now",
    base: baseChain ?? "couldn't be read just now",
    spentToday: {
      dollars: `${formatUnits(s.usdg + s.usdc, 6)} of ${formatUnits(USD_DAILY, 6)} (USDG ${formatUnits(s.usdg, 6)}, USDC on Base ${formatUnits(s.usdc, 6)})`,
      autonomo: `${formatUnits(s.autonomo, 18)} of ${formatUnits(TOKENS.autonomo.daily, 18)}`,
    },
    perCallCap: { dollars: formatUnits(TOKENS.usdg.cap, 6), autonomo: formatUnits(TOKENS.autonomo.cap, 18) },
    defaultPayment: PAY_LABEL[DEFAULT_PAY],
    note: "Paying in $AUTONOMO needs a little ETH on Robinhood Chain once, for the Permit2 approval. USDG and USDC need none.",
  };
}

// ---------- MCP ----------

const ok = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (e) {
    const message = e instanceof Stop ? e.message : e?.name === "TimeoutError" ? "The request timed out." : (e?.shortMessage ?? e?.message ?? String(e));
    return { content: [{ type: "text", text: message }], isError: true };
  }
};

const server = new McpServer({ name: "autonomo", version: VERSION });

server.registerTool(
  "find_apis",
  {
    title: "Find Autonomo APIs",
    description:
      "Search the paid APIs on Autonomo (token prices, new launches, rug-risk checks, wallet portfolios, transaction explainers, " +
      "page reader and more on Robinhood Chain). Returns each API's slug, price and the path to call. verified means the provider holds the Verified minimum of " +
      "$AUTONOMO; it isn't a review of the API. Free. " +
      "Set include_directory to also search Autonomo's directory of 4K+ x402 projects on other networks (listed for reference; " +
      "call_api only pays Autonomo gateways).",
    inputSchema: {
      query: z.string().max(200).optional().describe("What the API should do, e.g. 'token risk' or 'wallet holdings'. Leave empty to list all."),
      include_directory: z.boolean().optional().describe("Also search the x402 directory (other projects and networks)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  wrap(async ({ query = "", include_directory = false }) => {
    const { data } = await getJson(`${BASE}/api/v1/gateways`);
    const words = query.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 1);
    const score = (g) => words.filter((w) => `${g.slug} ${g.name} ${g.description}`.toLowerCase().includes(w)).length;
    const apis = words.length ? data.map((g) => [score(g), g]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).map(([, g]) => g) : data;
    const result = {
      apis: (apis.length ? apis : data).map(({ slug, name, description, usage, price, verified }) => ({ slug, name, description, path: usage, price, verified })),
      note: !data.length
        ? "No Autonomo APIs are listed right now."
        : apis.length || !words.length
          ? undefined
          : "No close match, so every Autonomo API is listed.",
      next: "Call get_price or call_api with a slug and the path (fill in the <…> parts).",
    };
    if (include_directory && query) {
      const dir = await getJson(`${BASE}/api/v1/projects?q=${encodeURIComponent(query)}&limit=8`);
      result.directory = dir.data.map((p) => ({
        name: p.name,
        description: p.description,
        networks: p.networks,
        minPriceUsd: p.minPriceUsd,
        paidCalls30d: p.calls30d,
        website: p.website,
        page: `${BASE}${p.url}`,
      }));
    }
    return result;
  }),
);

server.registerTool(
  "get_price",
  {
    title: "Check an API's price",
    description:
      "Call an Autonomo API without paying and return its price in USDG and $AUTONOMO on Robinhood Chain, and USDC on Base where it takes it. Free; use it before call_api.",
    inputSchema: {
      slug: z.string().describe("The API's slug from find_apis, e.g. token-risk."),
      path: z.string().max(2000).optional().describe("The path from find_apis with the <…> parts filled in, e.g. /risk/0xabc…"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  wrap(async ({ slug, path }) => {
    const url = gatewayUrl(slug, path);
    const required = await quote(url);
    return { url, description: required.resource?.description ?? null, offers: offersFrom(required), defaultPayment: PAY_LABEL[DEFAULT_PAY] };
  }),
);

server.registerTool(
  "call_api",
  {
    title: "Pay for and call an API",
    description:
      "Pay for one call to an Autonomo API with x402 and return the answer. Spends USDG or $AUTONOMO from the configured wallet on " +
      "Robinhood Chain (usually 0.01 USDG, or 20% less in $AUTONOMO), or USDC on Base at the same dollar price, within a per-call cap " +
      "and a daily budget. Returns the data and the payment transaction link.",
    inputSchema: {
      slug: z.string().describe("The API's slug from find_apis, e.g. token-risk."),
      path: z.string().max(2000).optional().describe("The path from find_apis with the <…> parts filled in, e.g. /risk/0xabc…"),
      pay_with: z
        .enum(["auto", "usdg", "autonomo", "usdc"])
        .optional()
        .describe(`Token to pay with: usdg or autonomo on Robinhood Chain, usdc on Base, or auto for the first of those the wallet can pay with (default ${DEFAULT_PAY}).`),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  wrap(async ({ slug, path, pay_with }) => pay(gatewayUrl(slug, path), pay_with ?? DEFAULT_PAY)),
);

server.registerTool(
  "wallet_status",
  {
    title: "Check the agent's wallet",
    description:
      "What the configured wallet holds (USDG, $AUTONOMO and ETH on Robinhood Chain, USDC on Base), what it has spent today and its " +
      "limits. Free, and it signs nothing. Use it when a payment fails, or before a run of paid calls.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  wrap(async () => walletStatus()),
);

await server.connect(new StdioServerTransport());
console.error(`Autonomo MCP server ${VERSION} ready (${BASE})`);
