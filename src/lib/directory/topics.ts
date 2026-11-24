// The directory's topics and price bands: the two filters on the Explore page that aren't a column of their own.
//
// Projects carry free-form tags (thousands of different ones, and many projects have none), so a topic is a short
// list of words looked for in a project's name and description, plus the tags that mean the same thing. An API can
// match several topics. Kept free of server-only imports so the lists can be tested on their own.

export type Topic = {
  id: string;
  label: string;
  /** Single words, with no hyphens, matched in the name and description with English stemming ("token" finds "tokens"). */
  words: string[];
  /** Tags that put a project in this topic, matched exactly. */
  tags: string[];
};

export const TOPICS: Topic[] = [
  {
    id: "crypto",
    label: "Crypto and tokens",
    words: ["crypto", "defi", "token", "onchain", "wallet", "solana", "evm", "nft", "dex", "swap", "blockchain", "trading", "bitcoin", "ethereum"],
    tags: ["crypto", "defi", "token", "onchain", "on-chain", "wallet", "market-data", "crypto-data", "solana", "evm", "nft", "dex", "trading"],
  },
  {
    id: "web",
    label: "Web and search",
    words: ["search", "scrape", "scraper", "crawl", "markdown", "seo", "browser", "screenshot", "webpage", "url"],
    tags: ["web", "search", "scraping", "scraper", "crawl", "markdown", "seo", "browser", "screenshot"],
  },
  {
    id: "agents",
    label: "Agent tools",
    // "agent" is in most descriptions ("any agent can pay"), so only tags and narrower words count here.
    words: ["mcp", "a2a", "orchestration"],
    tags: ["agents", "agent", "ai-agents", "ai-agent", "mcp", "a2a", "workflow", "memory", "orchestration"],
  },
  {
    id: "research",
    label: "Research and data",
    words: ["research", "finance", "financial", "weather", "news", "dataset", "analytics", "statistics", "economic"],
    tags: ["research", "data", "finance", "weather", "weather-data", "news", "sec", "analytics", "economic-research", "company-data"],
  },
  {
    id: "ai",
    label: "AI models",
    words: ["llm", "nlp", "inference", "gpt", "embedding", "transcription", "speech"],
    tags: ["ai", "llm", "nlp", "inference", "image-generation", "text-to-image", "text-to-speech", "embeddings", "transcription", "speech", "vision", "generator"],
  },
  {
    id: "compliance",
    label: "Compliance and risk",
    words: ["compliance", "sanction", "ofac", "aml", "kyc", "audit", "cve", "vulnerability", "fraud", "security"],
    tags: ["compliance", "sanctions", "ofac", "aml", "kyc", "audit", "risk", "security", "due-diligence", "verification", "software-security"],
  },
  {
    id: "utilities",
    label: "Time and utilities",
    words: ["timezone", "clock", "converter", "qr", "pdf", "email", "validator", "formatter"],
    tags: ["time", "timezone", "clock", "world-clock", "now", "utility", "utilities", "converter", "qr", "pdf", "email"],
  },
];

export const topic = (id: string | undefined): Topic | undefined => TOPICS.find((t) => t.id === id);

/** A topic's words as a Postgres text-search query: any one of them. */
export const topicTsQuery = (t: Topic): string => t.words.join(" | ");

export type PriceBand = { id: string; label: string; over: number | null; upTo: number | null };

/** Price per call of a project's cheapest endpoint, in dollars. A band takes prices over `over`, up to `upTo`. */
export const PRICE_BANDS: PriceBand[] = [
  { id: "1c", label: "Up to $0.01", over: null, upTo: 0.01 },
  { id: "5c", label: "$0.01 to $0.05", over: 0.01, upTo: 0.05 },
  { id: "25c", label: "$0.05 to $0.25", over: 0.05, upTo: 0.25 },
  { id: "more", label: "Over $0.25", over: 0.25, upTo: null },
];

export const priceBand = (id: string | undefined): PriceBand | undefined => PRICE_BANDS.find((b) => b.id === id);
