import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
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

export type Project = typeof projects.$inferSelect;
export type Endpoint = typeof endpoints.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
