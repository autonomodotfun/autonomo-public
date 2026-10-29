import "server-only";
import { formatUnits } from "viem";
import { TOKEN } from "@/lib/constants";
import { checkUpstream } from "@/lib/gateway";
import { USDG } from "@/lib/pro";

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
      await res.body?.cancel();
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
      await res.body?.cancel();
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
const GATEWAY_PATHS: Record<string, (question: string) => string | null> = {
  "token-price": () => "/price/autonomo",
  "new-launches": () => "/launches?limit=10",
  "token-risk": (q) => {
    const address = q.match(/0x[0-9a-fA-F]{40}/)?.[0] ?? (/\$?autonomo\b/i.test(q) ? TOKEN.address : null);
    return address ? `/risk/${address.toLowerCase()}` : null;
  },
};

// A question that shows off each known gateway; others get a generic one built from their name.
const EXAMPLE_QUESTIONS: Record<string, string> = {
  "token-price": "What's the current price of $AUTONOMO?",
  "new-launches": "What are the newest token launches?",
  "token-risk": "Is $AUTONOMO safe? Run a rug-risk check",
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
  if (/0x[0-9a-fA-F]{40}/.test(question) || /\b(safe|rug|risk|scam|legit|holders?)\b/i.test(question)) extra.push("risk", "rug");
  return extra;
}

const usd = (n: number) => (n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`);

const compactUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

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
    if (typeof d.priceUsd === "number") {
      const name = typeof d.token === "string" ? `$${d.token.replace(/^\$/, "")}` : "The token";
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
