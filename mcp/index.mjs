#!/usr/bin/env node
// Autonomo MCP server: lets Claude, Codex, Cursor and other MCP clients find Autonomo x402 APIs, check the price
// and pay per call in USDG or $AUTONOMO on Robinhood Chain, from a wallet the user controls.
//
// Tools: find_apis (free), get_price (free), call_api (pays). Runs locally over stdio, so the wallet key never
// leaves this machine except as signed payments. Settings come from env vars (see README.md). Never write to
// stdout here: it carries the MCP protocol, so logs go to stderr.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, maxUint256, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { z } from "zod";

const VERSION = "0.1.1";
const BASE = (process.env.AUTONOMO_BASE_URL || "https://autonomo.fun").replace(/\/+$/, "");
const NETWORK = "eip155:4663";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// The two tokens this server pays with, each with a hard cap per call and a daily budget (env overrides).
const TOKENS = {
  usdg: {
    symbol: "USDG",
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    decimals: 6,
    cap: parseUnits("0.05", 6),
    daily: parseUnits(process.env.AUTONOMO_DAILY_USDG || "1", 6),
  },
  autonomo: {
    symbol: "AUTONOMO",
    address: "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96",
    decimals: 18,
    cap: parseUnits("5000", 18),
    daily: parseUnits(process.env.AUTONOMO_DAILY_AUTONOMO || "10000", 18),
  },
};
const DEFAULT_PAY = (process.env.AUTONOMO_PAY_WITH || "usdg").toLowerCase() === "autonomo" ? "autonomo" : "usdg";

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
const tokenOf = (asset) => Object.values(TOKENS).find((t) => t.address.toLowerCase() === String(asset).toLowerCase());

// ---------- Daily budget, kept in ~/.autonomo-mcp/spend.json (base units per token, reset each UTC day) ----------

const SPEND_FILE = join(homedir(), ".autonomo-mcp", "spend.json");
const today = () => new Date().toISOString().slice(0, 10);

function spentToday() {
  try {
    const s = JSON.parse(readFileSync(SPEND_FILE, "utf8"));
    if (s.date === today()) return { usdg: BigInt(s.usdg ?? 0), autonomo: BigInt(s.autonomo ?? 0) };
  } catch {
    // No file yet, or unreadable: nothing spent today.
  }
  return { usdg: 0n, autonomo: 0n };
}

function recordSpend(pay, amount) {
  const s = spentToday();
  s[pay] += amount;
  mkdirSync(join(homedir(), ".autonomo-mcp"), { recursive: true });
  writeFileSync(SPEND_FILE, JSON.stringify({ date: today(), usdg: s.usdg.toString(), autonomo: s.autonomo.toString() }));
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
    const t = tokenOf(a.asset);
    return { token: t?.symbol ?? a.asset, amount: formatUnits(BigInt(a.amount), t?.decimals ?? 18), network: a.network, payTo: a.payTo };
  });
}

// ---------- Paying ----------

function walletKey() {
  const key = process.env.AUTONOMO_WALLET_KEY?.trim();
  if (!key) fail("No wallet set. Add AUTONOMO_WALLET_KEY (a dedicated wallet with a little USDG or $AUTONOMO) to this server's env in your MCP config.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("AUTONOMO_WALLET_KEY should be 0x followed by 64 hex characters.");
  return key;
}

async function pay(url, payWith) {
  const token = TOKENS[payWith];
  const account = privateKeyToAccount(walletKey());
  const pub = createPublicClient({ chain: robinhood, transport: http(RPC) });

  const required = await quote(url);
  const choice = required.accepts.find((a) => a.network === NETWORK && a.asset.toLowerCase() === token.address.toLowerCase());
  if (!choice) fail(`This API doesn't accept ${token.symbol}. It accepts: ${offersFrom(required).map((o) => `${o.amount} ${o.token}`).join(", ")}.`);
  const amount = BigInt(choice.amount);
  const price = `${formatUnits(amount, token.decimals)} ${token.symbol}`;

  if (amount > token.cap) fail(`The price (${price}) is above this server's cap of ${formatUnits(token.cap, token.decimals)} ${token.symbol} per call.`);
  const spent = spentToday()[payWith];
  if (spent + amount > token.daily) {
    fail(
      `Daily budget reached: ${formatUnits(spent, token.decimals)} of ${formatUnits(token.daily, token.decimals)} ${token.symbol} spent today (UTC). ` +
        `Raise AUTONOMO_DAILY_${payWith.toUpperCase()} to allow more.`,
    );
  }
  const balance = await pub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance < amount) fail(`Not enough ${token.symbol}: the wallet ${account.address} has ${formatUnits(balance, token.decimals)}, the call costs ${price}.`);

  // $AUTONOMO is paid through Permit2: one approval transaction the first time (needs a little ETH for gas).
  let approveTx = null;
  if (choice.extra?.assetTransferMethod === "permit2") {
    const allowance = await pub.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
    if (allowance < amount) {
      const wallet = createWalletClient({ account, chain: robinhood, transport: http(RPC) });
      approveTx = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
      await pub.waitForTransactionReceipt({ hash: approveTx });
    }
  }

  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(toClientEvmSigner(account, pub), { rpcUrl: RPC }) }],
    spendControls: {
      allowedAssets: [{ network: NETWORK, asset: token.address, maxAmountPerPayment: token.cap.toString() }],
      maxAmountPerPayment: false,
    },
    paymentRequirementsSelector: (_v, reqs) => reqs.find((r) => r.asset.toLowerCase() === token.address.toLowerCase()) ?? reqs[0],
  });
  const res = await wrapFetchWithPayment(fetch, client)(url, { signal: AbortSignal.timeout(60_000) });
  if (res.status !== 200) {
    const reason = decode(res.headers.get("payment-required"))?.error;
    fail(reason ? `Payment rejected: ${reason}` : `The API answered ${res.status} after payment (you weren't charged if it didn't settle).`);
  }
  const settlement = decode(res.headers.get("payment-response"));
  const tx = settlement?.transaction ?? null;
  recordSpend(payWith, amount);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 20_000);
  }
  return {
    paid: { amount: formatUnits(amount, token.decimals), token: token.symbol, from: account.address, to: choice.payTo },
    tx: tx ? `${EXPLORER}/tx/${tx}` : null,
    approveTx: approveTx ? `${EXPLORER}/tx/${approveTx}` : null,
    spentToday: `${formatUnits(spentToday()[payWith], token.decimals)} of ${formatUnits(token.daily, token.decimals)} ${token.symbol}`,
    data,
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
      "Set include_directory to also search Autonomo's directory of 3.7K x402 projects on other networks (listed for reference; " +
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
    description: "Call an Autonomo API without paying and return its price in USDG and $AUTONOMO. Free; use it before call_api.",
    inputSchema: {
      slug: z.string().describe("The API's slug from find_apis, e.g. token-risk."),
      path: z.string().max(2000).optional().describe("The path from find_apis with the <…> parts filled in, e.g. /risk/0xabc…"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  wrap(async ({ slug, path }) => {
    const url = gatewayUrl(slug, path);
    const required = await quote(url);
    return { url, description: required.resource?.description ?? null, offers: offersFrom(required), defaultPayment: TOKENS[DEFAULT_PAY].symbol };
  }),
);

server.registerTool(
  "call_api",
  {
    title: "Pay for and call an API",
    description:
      "Pay for one call to an Autonomo API with x402 and return the answer. Spends USDG or $AUTONOMO from the configured wallet on " +
      "Robinhood Chain (usually 0.01 USDG or 100 $AUTONOMO), within a per-call cap and a daily budget. Returns the data and the " +
      "payment transaction link.",
    inputSchema: {
      slug: z.string().describe("The API's slug from find_apis, e.g. token-risk."),
      path: z.string().max(2000).optional().describe("The path from find_apis with the <…> parts filled in, e.g. /risk/0xabc…"),
      pay_with: z.enum(["usdg", "autonomo"]).optional().describe(`Token to pay with (default ${DEFAULT_PAY}).`),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  wrap(async ({ slug, path, pay_with }) => pay(gatewayUrl(slug, path), pay_with ?? DEFAULT_PAY)),
);

await server.connect(new StdioServerTransport());
console.error(`Autonomo MCP server ${VERSION} ready (${BASE})`);
