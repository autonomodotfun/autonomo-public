import "server-only";
import { formatUnits } from "viem";
import { TOKEN } from "@/lib/constants";
import { checkUpstream } from "@/lib/gateway";
import { USDG } from "@/lib/payments";

// Words that say nothing about which API to pick.
const STOPWORDS = new Set(
  ("a an and are as at be by can could current currently do does for from get give how i in is it latest me my now " +
    "of on or please price prices show tell the this to today use using what whats what's when where which who why " +
    "will with would you your paid api apis need if one some right")
    .split(" "),
);

/** Search keywords from a plain-language question. "price" is kept only when it's the only word left. */
export function keywordsFrom(question: string) {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9$\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^\$/, "").replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 1);
  const kept = [...new Set(words.filter((w) => !STOPWORDS.has(w)))].slice(0, 8);
  if (/\bprices?\b/.test(question.toLowerCase())) kept.push("price");
  return kept;
}

export type Offer = { token: string; amount: string; network: string; payTo?: string };

const KNOWN: Record<string, { symbol: string; decimals: number }> = {
  [USDG.address.toLowerCase()]: { symbol: "USDG", decimals: 6 },
  [TOKEN.address.toLowerCase()]: { symbol: "$AUTONOMO", decimals: 18 },
};

function toOffer(a: { amount?: string; maxAmountRequired?: string; asset?: string; network?: string; payTo?: string; extra?: { name?: string } }): Offer | null {
  const raw = a.amount ?? a.maxAmountRequired;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const known = KNOWN[String(a.asset).toLowerCase()];
  // Unknown assets are almost always USDC (6 decimals) in the x402 catalogs.
  const symbol = known?.symbol ?? (/usd/i.test(a.extra?.name ?? "") || !a.extra?.name ? "USDC" : a.extra.name);
  return { token: symbol, amount: formatUnits(BigInt(raw), known?.decimals ?? 6), network: a.network ?? "", payTo: a.payTo };
}

function decodeHeader(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export type Quote = { ok: true; status: 402; offers: Offer[] } | { ok: false; status?: number; error: string };

/** Calls an endpoint without paying and reads the x402 price list from its 402 response. */
export async function quote(raw: string): Promise<Quote> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
  // Same public-address check as gateway upstreams; it's run on the origin because endpoints may carry a query.
  const safe = await checkUpstream(url.origin);
  if (!safe.ok) return { ok: false, error: safe.error };
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json", "user-agent": "AutonomoPlayground/1.0" },
    });
    if (res.status !== 402) {
      void res.body?.cancel().catch(() => {});
      return { ok: false, status: res.status, error: `Expected 402, got ${res.status}` };
    }
    let required = decodeHeader(res.headers.get("payment-required"));
    if (!required) {
      const text = (await res.text()).slice(0, 20_000);
      try {
        required = JSON.parse(text);
      } catch {
        required = null;
      }
    } else {
      void res.body?.cancel().catch(() => {});
    }
    const offers = (Array.isArray(required?.accepts) ? required.accepts : []).map(toOffer).filter(Boolean) as Offer[];
    if (!offers.length) return { ok: false, status: 402, error: "The 402 response had no price list" };
    return { ok: true, status: 402, offers: offers.slice(0, 4) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "The API didn't answer in time" : "Couldn't reach the API" };
  }
}

// How the playground calls each gateway: the path after /x/<slug> that answers a plain question.
// Gateways not listed here are called at their root. A null path means the question lacks a needed input.
const TX_HASH = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const HTTPS_URL = /https:\/\/[^\s<>"']+/i;

// $AUTONOMO by name, but not the autonomo.fun website.
const AUTONOMO_NAME = /\$?autonomo\b(?!\.)/i;

/** A contract or wallet address in the question (not part of a tx hash), or $AUTONOMO's when it's named. */
function addressIn(q: string, allowAutonomo = true) {
  const cleaned = q.replace(TX_HASH, " ").replace(HTTPS_URL, " ");
  return cleaned.match(ADDRESS)?.[0]?.toLowerCase() ?? (allowAutonomo && AUTONOMO_NAME.test(cleaned) ? TOKEN.address : null);
}

// Words that tell two APIs with the same input apart: a token address can go to the risk check, the creator's
// record or the holder list, a hash to the explainer or the payment check, a link to the reader or one of the checks.
const DEV_WORDS = /\b(devs?|developers?|creators?|deployers?)\b/i;
const HOLDER_WORDS = /\b(holders?|bundles?|bundled|snipers?|sniped|clusters?)\b/i;
const PAYMENT_WORDS = /\b(paid|pay|payments?|settled?|settlement|receipt|x402)\b/i;
const ENDPOINT_WORDS = /\b(endpoints?|x402|402|payable|health|healthy|up|down)\b/i;
const SITE_WORDS = /\b(websites?|site|domains?|phishing|scam|legit|trust|trusted|safe)\b/i;
const DOMAIN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;

const linkIn = (q: string) => q.match(HTTPS_URL)?.[0]?.replace(/[).,!?]+$/, "") ?? null;

const GATEWAY_PATHS: Record<string, (question: string) => string | null> = {
  "dev-wallet": (q) => {
    const address = addressIn(q);
    return address && DEV_WORDS.test(q) ? `/dev/${address}` : null;
  },
  "holders-bundles": (q) => {
    const address = addressIn(q);
    return address && HOLDER_WORDS.test(q) ? `/holders/${address}` : null;
  },
  "payment-check": (q) => {
    const hash = q.match(TX_HASH)?.[0];
    if (!hash || !PAYMENT_WORDS.test(q)) return null;
    // "…to 0x… for 0.01 USDG" turns the answer into a yes or no on that receipt.
    const params = new URLSearchParams();
    const to = addressIn(q, false);
    const amount = q.replace(TX_HASH, " ").match(/(\d+(?:\.\d+)?)\s*(usdg|\$?autonomo)\b/i);
    if (to) params.set("to", to);
    if (amount) {
      params.set("amount", amount[1]);
      params.set("asset", amount[2].replace("$", "").toLowerCase());
    }
    const query = params.toString();
    return `/payment/${hash.toLowerCase()}${query ? `?${query}` : ""}`;
  },
  "gas-now": (q) => (/\bgas\b/i.test(q) ? "/gas" : null),
  "endpoint-health": (q) => {
    const url = linkIn(q);
    return url && ENDPOINT_WORDS.test(q) ? `/endpoint?url=${encodeURIComponent(url)}` : null;
  },
  "website-check": (q) => {
    const target = linkIn(q) ?? q.replace(TX_HASH, " ").match(DOMAIN)?.[0] ?? null;
    return target && SITE_WORDS.test(q) ? `/site?url=${encodeURIComponent(target)}` : null;
  },
  "token-price": () => "/price/autonomo",
  "new-launches": () => "/launches?limit=10",
  "token-risk": (q) => {
    const address = addressIn(q);
    return address ? `/risk/${address}` : null;
  },
  "token-lookup": (q) => {
    const address = addressIn(q);
    return address ? `/price/${address}` : null;
  },
  "tx-explainer": (q) => {
    const hash = q.match(TX_HASH)?.[0];
    return hash ? `/tx/${hash.toLowerCase()}` : null;
  },
  "wallet-portfolio": (q) => {
    const address = addressIn(q, false);
    return address ? `/portfolio/${address}` : null;
  },
  "page-reader": (q) => {
    const url = q.match(HTTPS_URL)?.[0]?.replace(/[).,!?]+$/, "");
    return url ? `/page?url=${encodeURIComponent(url)}` : null;
  },
  "ostrapad-offer-finder": (q) => `/offers?q=${encodeURIComponent(q.trim().slice(0, 200))}`,
};

// The path to call after /x/<slug>, shown to outside agents (MCP server, /api/v1/gateways).
export const GATEWAY_USAGE: Record<string, string> = {
  "token-price": "/price/autonomo",
  "new-launches": "/launches?limit=10",
  "token-risk": "/risk/<token contract address>",
  "token-lookup": "/price/<token contract address>",
  "tx-explainer": "/tx/<transaction hash>",
  "wallet-portfolio": "/portfolio/<wallet address>",
  "page-reader": "/page?url=<url-encoded https:// link>",
  "ostrapad-offer-finder": "/offers?q=<what you need done>",
  "dev-wallet": "/dev/<token contract address>",
  "holders-bundles": "/holders/<token contract address>",
  "payment-check": "/payment/<transaction hash> (optional: ?to=<address>&amount=<number>&asset=usdg|autonomo)",
  "gas-now": "/gas",
  "endpoint-health": "/endpoint?url=<url-encoded https:// link> (optional: &method=POST)",
  "website-check": "/site?url=<website link or domain>",
};

// What each gateway needs when the question doesn't include it.
export const MISSING_INPUT: Record<string, string> = {
  "dev-wallet": "a token contract address, and the word creator or dev",
  "holders-bundles": "a token contract address, and the word holders or bundles",
  "payment-check": "a transaction hash, and the word payment",
  "gas-now": "the word gas",
  "endpoint-health": "an https:// link, and the word endpoint or x402",
  "website-check": "a website link or domain, and a word like safe or legit",
  "token-risk": "a token contract address",
  "token-lookup": "a token contract address",
  "tx-explainer": "a transaction hash",
  "wallet-portfolio": "a wallet address",
  "page-reader": "an https:// link",
};

// A question that shows off each known gateway; others get a generic one built from their name.
const EXAMPLE_QUESTIONS: Record<string, string> = {
  "token-price": "What's the current price of $AUTONOMO?",
  "new-launches": "What are the newest token launches?",
  "token-risk": "Is $AUTONOMO safe? Run a rug-risk check",
  "token-lookup": `Price of token ${TOKEN.address}`,
  "tx-explainer": "Explain transaction 0x7bd85b4da40a3cf8f5445faa3affac958661f33e4f3790abe288161af6615f07",
  "wallet-portfolio": "What does wallet 0xde87838695ba7151ae93ca24c96b2f5334f4988b hold?",
  "page-reader": "Read this page: https://autonomo.fun/docs",
  "ostrapad-offer-finder": "Find an Ostrapad agent that writes a protocol risk report",
  "dev-wallet": "What did the creator of $AUTONOMO do with their tokens?",
  "holders-bundles": "Who holds $AUTONOMO? Check holders, bundles and snipers",
  "payment-check": "Did this payment settle? 0x01295eba2c428270708417f658d9a4a2f0fb08bfecd1d1229e0b0752c7bfd612",
  "gas-now": "What does gas cost on Robinhood Chain right now?",
  "endpoint-health": "Is this x402 endpoint up and payable? https://autonomo.fun/x/token-price",
  "website-check": "Is the website autonomo.fun safe?",
};

export function exampleQuestion(slug: string, name: string) {
  return EXAMPLE_QUESTIONS[slug] ?? `Use ${name}`;
}

export function gatewayPath(slug: string, question: string) {
  const path = GATEWAY_PATHS[slug];
  return path ? path(question) : "";
}

/** Keywords for gateways that need an input the plain keyword search wouldn't see. */
export function intentKeywords(question: string) {
  const extra: string[] = [];
  const hasAddress = ADDRESS.test(question.replace(TX_HASH, " "));
  const hasLink = HTTPS_URL.test(question);
  // A link or a domain with a word like "safe" is a question about the website, not about a token.
  const aboutSite = SITE_WORDS.test(question) && (hasLink || (!hasAddress && DOMAIN.test(question.replace(TX_HASH, " "))));
  const aboutToken = hasAddress || AUTONOMO_NAME.test(question);
  const aboutPayment = TX_HASH.test(question) && PAYMENT_WORDS.test(question);
  if (TX_HASH.test(question)) extra.push(...(aboutPayment ? ["payment", "check", "settle"] : ["transaction", "explain", "explainer"]));
  if (hasLink && ENDPOINT_WORDS.test(question)) extra.push("endpoint", "health", "payable");
  else if (aboutSite) extra.push("website", "check", "domain", "phishing");
  else if (hasLink) extra.push("page", "read", "reader", "text");
  if (/\bgas\b/i.test(question)) extra.push("gas");
  if (/\b(ostrapad|hire|freelancers?)\b/i.test(question)) extra.push("ostrapad", "offer", "finder");
  // These three are settled by now; an address beside them is a detail of the question, not a token to look up.
  if (aboutPayment || aboutSite || (hasLink && ENDPOINT_WORDS.test(question))) return extra;
  if (aboutToken && DEV_WORDS.test(question)) extra.push("dev", "wallet", "tracker", "creator");
  else if (aboutToken && HOLDER_WORDS.test(question)) extra.push("holders", "bundles", "snipers");
  else if (/\b(safe|rug|risk|scam|legit)\b/i.test(question)) extra.push("risk", "rug");
  else if (hasAddress && /\b(wallet|portfolio|holdings?|holds?|balances?|owns?)\b/i.test(question)) extra.push("wallet", "portfolio");
  else if (hasAddress) extra.push("token", "price", "lookup");
  return extra;
}

const usd = (n: number) => (n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`);

const compactUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;

/** A short answer from the data an API returned: a list for launch feeds, a sentence for prices. */
export function answerFrom(data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, any>;
    if (d.risk && typeof d.risk.level === "string") {
      const name = d.symbol ? `$${d.symbol}` : "This token";
      const flags = Array.isArray(d.risk.flags) ? d.risk.flags.slice(0, 4).map((f: Record<string, any>) => `• ${f.text}`) : [];
      const facts = [
        typeof d.holders?.count === "number" ? `${d.holders.count} holders` : "",
        typeof d.holders?.top10Percent === "number" ? `top 10 hold ${d.holders.top10Percent.toFixed(1)}%` : "",
        typeof d.market?.marketCapUsd === "number" ? `${compactUsd(d.market.marketCapUsd)} mcap` : "",
      ].filter(Boolean).join(" · ");
      return [`${name} rug risk: ${d.risk.level.toUpperCase()} (score ${d.risk.score})`, ...flags, facts, "Heuristic from on-chain data, not financial advice."]
        .filter(Boolean).join("\n");
    }
    if (Array.isArray(d.offers) && typeof d.listedAgents === "number") {
      const lines = d.offers.slice(0, 5).map((m: Record<string, any>, i: number) => {
        const o = m.offer ?? {};
        return `${i + 1}. ${o.title} by ${m.agent?.name ?? `agent ${m.agent?.agentId}`} · ${o.priceUsdg} USDG · ${o.delivers ?? ""}\n   ${m.record?.summary ?? ""}\n   ${m.ostrapad ?? ""}`;
      });
      return [`${d.matches} matching offer${d.matches === 1 ? "" : "s"} on Ostrapad:`, ...lines, "Order from an Ostra vault with Ostra's MCP (pad_order); the budget waits in escrow and comes back if the work is rejected."].join("\n");
    }
    if (Array.isArray(d.launches)) {
      if (!d.launches.length) return "No new launches found right now.";
      const lines = d.launches.slice(0, 10).map((l: Record<string, any>, i: number) => {
        const name = l.symbol ? `$${l.symbol}` : `${String(l.token).slice(0, 8)}…`;
        const age = typeof l.ageMinutes === "number" ? (l.ageMinutes < 60 ? `${l.ageMinutes} min ago` : `${Math.round(l.ageMinutes / 60)} h ago`) : "";
        const buys = l.trades ? `${l.trades.buys} buys` : "";
        const mcap = typeof l.marketCapUsd === "number" ? `${compactUsd(l.marketCapUsd)} mcap` : "";
        return `${i + 1}. ${name}${l.name && l.name !== l.symbol ? ` (${l.name})` : ""} · ${[age, buys, mcap].filter(Boolean).join(" · ")}`;
      });
      return [`The ${lines.length} newest launches on ${d.chain ?? "Robinhood Chain"}:`, ...lines].join("\n");
    }
    const flagLines = (max: number) =>
      Array.isArray(d.flags) ? d.flags.slice(0, max).map((f: Record<string, any>) => `• ${f.text}`) : [];
    const tokenName = d.token?.symbol ? `$${d.token.symbol}` : "This token";
    // Dev wallet tracker: who the creator is, what they hold, then what stands out.
    if (d.creator?.address && d.supply && typeof d.supply.holdsPercent === "number") {
      return [
        `${tokenName}'s creator is ${d.creator.address} and holds ${d.supply.holdsPercent.toFixed(2)}% of the supply.`,
        ...flagLines(6),
        "Read from on-chain data, not financial advice.",
      ].join("\n");
    }
    // Holders and bundles: what stands out, then the headline shares.
    if (Array.isArray(d.topHolders) && d.summary && typeof d.summary === "object") {
      const s = d.summary;
      const share = (label: string, v: unknown) => (typeof v === "number" ? `${label} ${v.toFixed(1)}%` : "");
      const facts = [share("largest wallet", s.largestWalletPercent), share("top 10 wallets", s.top10WalletsPercent), share("pool, launch and burn", s.poolLaunchBurnPercent)]
        .filter(Boolean).join(" · ");
      return [`Who holds ${tokenName}${d.token?.holders ? ` (${Number(d.token.holders).toLocaleString("en-US")} holders)` : ""}:`, ...flagLines(6), facts, "Linked wallets are probable, never proven. Not financial advice."]
        .filter(Boolean).join("\n");
    }
    // Gas now: the gas price, then what each common action costs.
    if (typeof d.gasPriceGwei === "number" && Array.isArray(d.costs)) {
      const rows = d.costs.map((c: Record<string, any>) => `• ${c.action}: ${typeof c.feeUsd === "number" ? `$${c.feeUsd < 0.01 ? c.feeUsd.toPrecision(2) : c.feeUsd.toFixed(2)}` : "no recent sample"}`);
      return [`Gas on ${d.chain ?? "Robinhood Chain"} is ${d.gasPriceGwei.toPrecision(3)} gwei right now:`, ...rows, d.payingAnAutonomoApi ?? ""].filter(Boolean).join("\n");
    }
    // Endpoint health: its verdict, then anything wrong with the payment request.
    if (typeof d.verdict === "string" && typeof d.summary === "string") {
      const problems = Array.isArray(d.problems) ? d.problems.slice(0, 4).map((p: unknown) => `• ${p}`) : [];
      return [`${d.summary}${typeof d.ms === "number" ? ` Answered in ${d.ms} ms.` : ""}`, ...problems].join("\n");
    }
    // Website check: the caution level, then what was found.
    if (typeof d.caution === "string" && typeof d.summary === "string") {
      return [`Caution ${d.caution}. ${d.summary}`, ...flagLines(5), "A screening from public records, not a guarantee."].join("\n");
    }
    // Payment check: its own sentence, which already says whether it matches what was asked.
    if (typeof d.summary === "string" && Array.isArray(d.payments)) return d.summary;
    // Transaction explainer: its own plain-English summary.
    if (typeof d.summary === "string" && typeof d.hash === "string") {
      const fee = typeof d.feeUsd === "number" ? ` Fee: $${d.feeUsd < 0.01 ? d.feeUsd.toPrecision(2) : d.feeUsd.toFixed(2)}.` : "";
      return `${d.summary}${fee}`;
    }
    // Wallet portfolio: total, then the biggest holdings.
    if (typeof d.totalUsd === "number" && Array.isArray(d.tokens)) {
      const rows = [
        d.eth?.amount > 0 ? `• ETH: ${Number(d.eth.amount).toPrecision(3)} (${compactUsd(d.eth.valueUsd ?? 0)})` : "",
        ...d.tokens.slice(0, 8).map((t: Record<string, any>) => {
          const amount = Number(t.amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
          const value = typeof t.valueUsd === "number" ? ` (${compactUsd(t.valueUsd)})` : " (no price)";
          return `• ${t.symbol ? `$${t.symbol}` : String(t.token).slice(0, 8)}: ${amount}${value}${t.warning ? " ⚠ likely impostor" : ""}`;
        }),
      ].filter(Boolean);
      return [`This wallet holds about ${compactUsd(d.totalUsd)} on ${d.chain ?? "Robinhood Chain"}:`, ...rows].join("\n");
    }
    // Page reader: title and the start of the text.
    if (typeof d.text === "string" && typeof d.url === "string") {
      const excerpt = d.text.replace(/\s+/g, " ").slice(0, 320);
      return [`${d.title ?? d.url}${typeof d.words === "number" ? ` (${d.words.toLocaleString("en-US")} words)` : ""}`, d.description ?? "", `${excerpt}${d.text.length > 320 ? "…" : ""}`]
        .filter(Boolean)
        .join("\n");
    }
    if (typeof d.priceUsd === "number") {
      const label = typeof d.symbol === "string" ? d.symbol : typeof d.token === "string" && !d.token.startsWith("0x") ? d.token : null;
      const name = label ? `$${label.replace(/^\$/, "")}` : "The token";
      const trade = d.lastTrade?.side && d.lastTrade?.time
        ? `, from the last on-chain ${d.lastTrade.side} at ${new Date(d.lastTrade.time).toUTCString().slice(17, 22)} UTC`
        : "";
      const eth = typeof d.priceEth === "number" ? ` (${d.priceEth.toPrecision(3)} ETH)` : "";
      return `${name} is about ${usd(d.priceUsd)}${eth}${trade}.`;
    }
    const text = JSON.stringify(data);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  }
  const text = String(data ?? "").trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text || "The API returned an empty answer.";
}
