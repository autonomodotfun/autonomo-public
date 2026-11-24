import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

import { CATEGORIES, type Category } from "../lib/constants";

export { CATEGORIES, type Category };

export const PROJECT_STATUSES = ["approved", "pending", "hidden"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").$type<Category>().notNull(),
    website: text("website"),
    github: text("github"),
    twitter: text("twitter"),
    docs: text("docs"),
    logoUrl: text("logo_url"),
    // Hostname that bazaar-imported endpoints are grouped under.
    host: text("host"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    networks: text("networks").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").$type<ProjectStatus>().notNull().default("approved"),
    source: text("source").notNull(),
    featured: boolean("featured").notNull().default(false),
    endpointCount: integer("endpoint_count").notNull().default(0),
    calls30d: integer("calls_30d").notNull().default(0),
    payers30d: integer("payers_30d").notNull().default(0),
    minPriceUsd: numeric("min_price_usd", { precision: 18, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),
  },
  (t) => [
    uniqueIndex("projects_slug_idx").on(t.slug),
    uniqueIndex("projects_host_idx").on(t.host),
    index("projects_category_idx").on(t.category),
    index("projects_status_idx").on(t.status),
    index("projects_search_idx").using("gin", t.search),
  ],
);

export const endpoints = pgTable(
  "endpoints",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    method: text("method").notNull().default("GET"),
    type: text("type").notNull().default("http"),
    description: text("description").notNull().default(""),
    network: text("network"),
    asset: text("asset"),
    amount: text("amount"),
    priceUsd: numeric("price_usd", { precision: 18, scale: 6 }),
    payTo: text("pay_to"),
    scheme: text("scheme"),
    facilitator: text("facilitator").notNull(),
    x402Version: integer("x402_version"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    bazaarInfo: jsonb("bazaar_info"),
    calls30d: integer("calls_30d").notNull().default(0),
    payers30d: integer("payers_30d").notNull().default(0),
    lastCalledAt: timestamp("last_called_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    // Filled in by the Phase 2 health checker.
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastStatus: integer("last_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("endpoints_url_method_idx").on(t.url, t.method),
    index("endpoints_project_idx").on(t.projectId),
    index("endpoints_network_idx").on(t.network),
  ],
);

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").$type<Category>().notNull(),
    website: text("website").notNull(),
    github: text("github"),
    twitter: text("twitter"),
    endpointUrl: text("endpoint_url"),
    contact: text("contact"),
    status: text("status").$type<SubmissionStatus>().notNull().default("pending"),
    reviewNote: text("review_note"),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("submissions_status_idx").on(t.status)],
);

// Hosted x402 gateways: an owner puts an existing API behind autonomo.fun/x/<slug>, priced per call.
// Payments go straight to the owner's wallet, or to payTo when one is set, unless burning is on: then they go through
// that wallet's burn splitter (src/lib/payments/burn.ts). Autonomo never holds funds.
export const GATEWAY_STATUSES = ["active", "paused"] as const;
export type GatewayStatus = (typeof GATEWAY_STATUSES)[number];
export const GATEWAY_LISTINGS = ["unlisted", "pending", "listed", "rejected"] as const;
export type GatewayListing = (typeof GATEWAY_LISTINGS)[number];

export const gateways = pgTable(
  "gateways",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    // Lowercased wallet address of the owner, who signs in and manages the gateway.
    owner: text("owner").notNull(),
    // Lowercased wallet that gets paid and holds for Verified instead of the owner, such as a Safe. The owner sets the
    // first one with a signature from their wallet, not just their session; after that only /admin changes it.
    payTo: text("pay_to"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    upstreamUrl: text("upstream_url").notNull(),
    // Optional header Autonomo adds when calling the upstream; the value is AES-GCM encrypted at rest.
    upstreamAuthHeader: text("upstream_auth_header"),
    upstreamAuthSecret: text("upstream_auth_secret"),
    priceUsd: numeric("price_usd", { precision: 18, scale: 6 }).notNull(),
    acceptUsdg: boolean("accept_usdg").notNull().default(true),
    // Whole $AUTONOMO tokens per call; null means $AUTONOMO is not accepted.
    autonomoAmount: text("autonomo_amount"),
    // USDC on Base at priceUsd, paid to the creator's splitter on Base. Only offered while Base is set up and the
    // payee can be paid there (see basePayToFor in the gateway route).
    acceptBase: boolean("accept_base").notNull().default(true),
    // The router (src/lib/router/router.ts). The service this API serves, such as "token-price"; null means it is only
    // callable by name.
    routeCapability: text("route_capability"),
    // How a routed request becomes a call to this API: its path with the capability's inputs in braces, such as
    // "/v1/price/{token}?chain={chain}".
    routePath: text("route_path"),
    // Standard field name -> where it is in this API's own answer, such as { "price_usd": "priceUsd" }. Null when the
    // API already answers with the standard field names.
    routeMapping: jsonb("route_mapping").$type<Record<string, string>>(),
    // Passed the format test for its capability, and when: that starts its week of three paid probes a day.
    routeFormatOk: boolean("route_format_ok").notNull().default(false),
    routeListedAt: timestamp("route_listed_at", { withTimezone: true }),
    status: text("status").$type<GatewayStatus>().notNull().default("active"),
    listing: text("listing").$type<GatewayListing>().notNull().default("unlisted"),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gateways_slug_idx").on(t.slug),
    index("gateways_owner_idx").on(t.owner),
    index("gateways_listing_idx").on(t.listing),
  ],
);

// One row per paid attempt through a gateway (requests that carried a payment).
export const gatewayCalls = pgTable(
  "gateway_calls",
  {
    id: serial("id").primaryKey(),
    gatewayId: integer("gateway_id")
      .notNull()
      .references(() => gateways.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    rail: text("rail"),
    asset: text("asset"),
    // The whole payment, whatever share of it is burned.
    amount: text("amount"),
    // The share of this payment burned, in basis points. 0 for payments that went straight to the payee.
    burnBps: integer("burn_bps").notNull().default(0),
    payer: text("payer"),
    settled: boolean("settled").notNull().default(false),
    tx: text("tx"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gateway_calls_gateway_created_idx").on(t.gatewayId, t.createdAt)],
);

// Every change of a creator's wallet made from /admin. Rows are only ever added.
export const walletSwitches = pgTable("wallet_switches", {
  id: serial("id").primaryKey(),
  fromOwner: text("from_owner").notNull(),
  toOwner: text("to_owner").notNull(),
  slugs: text("slugs").array().notNull(),
  // "owner" moved the gateways to a new owner; "pay_to" changed where the owner's gateways get paid, from /admin;
  // "pay_to_signed" is an owner setting their first Safe with a signature from their sign-in wallet.
  kind: text("kind").notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every decision made from /admin: listings approved or rejected, APIs paused, projects hidden, payout changes.
// Rows are only ever added. `subject` is what it was about, written the way the admin page shows it ("/x/slug", a
// project's slug, a wallet). `note` is the reason typed with a rejection, which the creator sees on their dashboard.
// `gatewayId` is a plain number, not a reference, so the history outlives an API that is later deleted.
export const adminEvents = pgTable(
  "admin_events",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    detail: text("detail"),
    note: text("note"),
    gatewayId: integer("gateway_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_events_created_idx").on(t.createdAt), index("admin_events_gateway_idx").on(t.gatewayId)],
);

// Every burn, copied from the chain's events by the burn keeper for the public /burn page. See src/lib/payments/burn.ts.
export const burnReceipts = pgTable(
  "burn_receipts",
  {
    tx: text("tx").notNull(),
    logIndex: integer("log_index").notNull(),
    // "payment" burned part of a $AUTONOMO payment; "buyback" bought with USDG; "other" burned tokens sent to the buyback.
    kind: text("kind").notNull(),
    // Atomic units, as text.
    burned: text("burned").notNull(),
    usdgIn: text("usdg_in"),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    burnedAt: timestamp("burned_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tx, t.logIndex] }), index("burn_receipts_block_idx").on(t.blockNumber)],
);

// A creator asking from the dashboard to move their APIs from their Safe to another. Only /admin approves it, so a
// signed-in session alone can't redirect the money. At most one is pending per owner.
export const PAY_TO_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type PayToRequestStatus = (typeof PAY_TO_REQUEST_STATUSES)[number];

export const payToRequests = pgTable(
  "pay_to_requests",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    payTo: text("pay_to").notNull(),
    status: text("status").$type<PayToRequestStatus>().notNull().default("pending"),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("pay_to_requests_pending_idx").on(t.owner).where(sql`${t.status} = 'pending'`)],
);

export type Gateway = typeof gateways.$inferSelect;
export type GatewayCall = typeof gatewayCalls.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Endpoint = typeof endpoints.$inferSelect;
export type Submission = typeof submissions.$inferSelect;

// One row per paid answer the Telegram agent bot gave, for each user's free daily allowance.
export const telegramQuestions = pgTable(
  "telegram_questions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    chatId: text("chat_id").notNull(),
    tx: text("tx"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("telegram_questions_user_created_idx").on(t.userId, t.createdAt)],
);

// One row per paid answer the Agent Playground gave a visitor, for the free daily allowance per visitor. The visitor
// is a SHA-256 hash of their IP, so raw IPs are never stored.
export const playgroundPayments = pgTable(
  "playground_payments",
  {
    id: serial("id").primaryKey(),
    visitor: text("visitor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playground_payments_visitor_created_idx").on(t.visitor, t.createdAt)],
);

// The $AUTONOMO amount a wallet is held to for Verified, saved when it first qualifies. See src/lib/trust/verified.ts.
export const verifiedWallets = pgTable("verified_wallets", {
  // Lowercased wallet address.
  owner: text("owner").primaryKey(),
  // Whole tokens.
  tokens: integer("tokens").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The $AUTONOMO amount a wallet's provider bond is held to for Bonded, saved when it first qualifies. Like
// verified_wallets: it never goes up for that wallet, and it is dropped when the bond falls below it. See src/lib/trust/bond.ts.
export const bondedWallets = pgTable("bonded_wallets", {
  // Lowercased wallet address: the wallet the APIs pay, which is the wallet that bonds.
  wallet: text("wallet").primaryKey(),
  // Whole tokens.
  tokens: integer("tokens").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per question the AI agent took, for costs and to see who comes back. Questions themselves aren't stored.
export const agentQuestions = pgTable(
  "agent_questions",
  {
    id: serial("id").primaryKey(),
    // "web" or "telegram".
    surface: text("surface").notNull(),
    // Keyed hash of the visitor's IP or Telegram id, never the id itself. See src/lib/agent/agent-limits.ts.
    subject: text("subject").notNull(),
    // "answer" or "fail".
    outcome: text("outcome").notNull(),
    // Null when the keyword agent answered, which uses no model.
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // What it paid for: [{ api, amount, tx }].
    receipts: jsonb("receipts").$type<{ api: string; amount: string; tx: string | null }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_questions_subject_created_idx").on(t.subject, t.createdAt), index("agent_questions_created_idx").on(t.createdAt)],
);

// Daily question counters. A counter row is updated in one statement, so simultaneous requests can't get past a limit.
export const agentLimits = pgTable("agent_limits", {
  // "<surface>:<subject>:<day>" for a visitor, "site:<day>" for everyone.
  key: text("key").primaryKey(),
  day: date("day", { mode: "string" }).notNull(),
  count: integer("count").notNull().default(0),
});

// The agent's recent conversations, so follow-up questions have context. See src/lib/agent/agent-conversations.ts.
export const agentConversations = pgTable(
  "agent_conversations",
  {
    // Random and unguessable: whoever holds it can continue the conversation.
    id: text("id").primaryKey(),
    surface: text("surface").notNull(),
    // Each turn: { question, answer, lookups }.
    turns: jsonb("turns").$type<{ question: string; answer: string; lookups: { tool: string; input: Record<string, unknown> }[] }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_conversations_updated_idx").on(t.updatedAt)],
);

// Gloam cash-out payments (see src/lib/payments/gloam.ts). An agent pays from its private Gloam balance by cashing out an exact
// amount to the gateway's splitter. Each 402 issues a quote; the retry names the quote and the cash-out transaction.
export const gloamQuotes = pgTable(
  "gloam_quotes",
  {
    // Random and unguessable, never on chain: only the agent that got the 402 can redeem a payment against it.
    id: text("id").primaryKey(),
    gatewayId: integer("gateway_id")
      .notNull()
      .references(() => gateways.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    // Lowercased splitter (or payee) the cash-out must reach.
    payTo: text("pay_to").notNull(),
    // The exact gross amount to cash out, in USDG base units: the price plus the vault fee plus a unique tag.
    gross: text("gross").notNull(),
    // The price the splitter must receive at least, in USDG base units.
    price: text("price").notNull(),
    // A hash of the requester's IP, to limit how many open quotes one visitor holds.
    requester: text("requester").notNull(),
    // While open, the gross amount is reserved for this splitter; a used or expired quote frees it.
    open: boolean("open").notNull().default(true),
    tx: text("tx"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gloam_quotes_open_amount_idx").on(t.payTo, t.gross).where(sql`${t.open}`),
    index("gloam_quotes_requester_idx").on(t.requester, t.issuedAt),
    index("gloam_quotes_issued_idx").on(t.issuedAt),
  ],
);

// Every cash-out transaction a gateway has taken. A row is claimed (locked) while the call runs, then marked used once
// the API answers below 400. A failed call releases it so the agent can retry with the same transaction.
export const gloamPayments = pgTable("gloam_payments", {
  tx: text("tx").primaryKey(),
  quoteId: text("quote_id").notNull(),
  used: boolean("used").notNull().default(false),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- the router (src/lib/router/router.ts, read and written by src/lib/router/router-store.ts) ----------

// One row per measured call: a call the router sent to an API, or a paid probe. Direct calls by name are not here.
// The answer rate that decides whether an API is routed is taken from these rows.
export const routerCalls = pgTable(
  "router_calls",
  {
    id: serial("id").primaryKey(),
    // The gateway's slug.
    slug: text("slug").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    valid: boolean("valid").notNull(),
    // How long the API took; null when it never answered.
    ms: integer("ms"),
    kind: text("kind").$type<"routed" | "probe">().notNull(),
    // Lowercased payer wallet, "" for a probe.
    payer: text("payer").notNull().default(""),
    settled: boolean("settled").notNull().default(false),
    reason: text("reason").notNull().default(""),
    // False for a "no answer for this input" (a 4xx), which is kept but is not part of the answer rate.
    counted: boolean("counted").notNull().default(true),
  },
  (t) => [index("router_calls_slug_at_idx").on(t.slug, t.at)],
);

// One row per free uptime probe, sent straight to an API's own server every 15 minutes.
export const routerUptime = pgTable(
  "router_uptime",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    up: boolean("up").notNull(),
  },
  (t) => [index("router_uptime_slug_at_idx").on(t.slug, t.at)],
);

// Executed slashes of the provider bond. A slash hits the pay-to wallet, so none of its APIs is routed for 30 days.
export const routerSlashes = pgTable(
  "router_slashes",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    // Lowercased pay-to wallet.
    payTo: text("pay_to").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [index("router_slashes_slug_idx").on(t.slug), index("router_slashes_pay_to_idx").on(t.payTo)],
);

// Payers whose settlement failed after an API answered. The router refuses them until `until`.
export const routerBlockedPayers = pgTable("router_blocked_payers", {
  // Lowercased wallet address.
  payer: text("payer").primaryKey(),
  until: timestamp("until", { withTimezone: true }).notNull(),
});

// One row per 402 the router answered: which API was chosen for the request, so the paid request goes to the API the
// agent saw the price of. Valid for 60 seconds and used once.
export const routerRoutes = pgTable("router_routes", {
  id: text("id").primaryKey(),
  capability: text("capability").notNull(),
  inputs: jsonb("inputs").$type<Record<string, string>>().notNull(),
  slug: text("slug").notNull(),
  // The APIs already tried for this request, and whether each said it had no answer for the input. `readyAt` is the
  // time an API that said "not ready yet" asked to be called again.
  tried: jsonb("tried").$type<{ slug: string; noData: boolean; readyAt?: number }[]>().notNull(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
});

// Requests to /route counted per caller and minute, for the rate limit. `key` is "ip:<address>" or "payer:<wallet>".
export const routerHits = pgTable(
  "router_hits",
  {
    key: text("key").notNull(),
    // The start of the minute.
    minute: timestamp("minute", { withTimezone: true }).notNull(),
    n: integer("n").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.key, t.minute] })],
);

// Each routable API's stats as last worked out from the tables above, so a request reads one row per API instead of
// counting its calls again. A copy only: the row is removed whenever the API's record changes, and one older than
// 15 minutes is not used (src/lib/router/router.ts).
export const routerStats = pgTable(
  "router_stats",
  {
    slug: text("slug").primaryKey(),
    // Lowercased pay-to wallet, so a slash can clear the rows of every API it covers.
    payTo: text("pay_to").notNull(),
    measured: integer("measured").notNull(),
    valid: integer("valid").notNull(),
    medianMs: doublePrecision("median_ms"),
    uptime: doublePrecision("uptime").notNull(),
    lastSlash: timestamp("last_slash", { withTimezone: true }),
    // When these stats were worked out.
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [index("router_stats_pay_to_idx").on(t.payTo)],
);
