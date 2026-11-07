import "server-only";
import { and, asc, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { CATEGORIES, type Category } from "@/db/schema";
import { TOKEN } from "@/lib/constants";
import { holdsMinimum } from "@/lib/verified";
import { summarize, TRACK_RECORD_DAYS, type TrackRecord } from "@/lib/track-record";

const { projects, endpoints } = schema;

export const SORTS = ["popular", "relevance", "new", "name", "price"] as const;
export type Sort = (typeof SORTS)[number];

export type ProjectQuery = {
  q?: string;
  category?: Category;
  network?: string;
  sort?: Sort;
  page?: number;
  limit?: number;
};

export const listColumns = {
  id: projects.id,
  slug: projects.slug,
  name: projects.name,
  description: projects.description,
  category: projects.category,
  website: projects.website,
  host: projects.host,
  tags: projects.tags,
  networks: projects.networks,
  featured: projects.featured,
  endpointCount: projects.endpointCount,
  calls30d: projects.calls30d,
  payers30d: projects.payers30d,
  minPriceUsd: projects.minPriceUsd,
  createdAt: projects.createdAt,
};
export type ProjectListItem = {
  [K in keyof typeof listColumns]: (typeof listColumns)[K]["_"]["data"];
};

export function parseProjectQuery(params: Record<string, string | string[] | undefined>): ProjectQuery {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const category = one("category");
  const sort = one("sort");
  const page = Number(one("page") ?? 1);
  const limit = Number(one("limit") ?? 30);
  return {
    q: one("q")?.slice(0, 100),
    category: CATEGORIES.includes(category as Category) ? (category as Category) : undefined,
    network: one("network")?.toLowerCase().slice(0, 40),
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : undefined,
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 1000) : 1,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 30,
  };
}

async function searchProjectsFresh(query: ProjectQuery) {
  const db = await getDb();
  const { q, category, network, page = 1, limit = 30 } = query;
  const sort: Sort = query.sort ?? (q ? "relevance" : "popular");

  const where: SQL[] = [eq(projects.status, "approved")];
  let rank: SQL<number> | undefined;
  if (q) {
    const tsq = sql`websearch_to_tsquery('english', ${q})`;
    rank = sql<number>`ts_rank(${projects.search}, ${tsq})`;
    where.push(
      or(
        sql`${projects.search} @@ ${tsq}`,
        ilike(projects.name, `%${escapeLike(q)}%`),
        ilike(projects.host, `%${escapeLike(q)}%`),
        sql`${q.toLowerCase()} = any(${projects.tags})`,
      )!,
    );
  }
  if (category) where.push(eq(projects.category, category));
  if (network) where.push(sql`${network} = any(${projects.networks})`);

  const order: SQL[] = {
    relevance: rank
      ? [desc(projects.featured), sql`${rank} desc`, desc(projects.calls30d)]
      : [desc(projects.featured), desc(projects.calls30d)],
    popular: [desc(projects.featured), desc(projects.calls30d), desc(projects.endpointCount)],
    new: [desc(projects.createdAt), desc(projects.id)],
    name: [asc(sql`lower(${projects.name})`)],
    price: [sql`${projects.minPriceUsd} asc nulls last`, desc(projects.calls30d)],
  }[sort];

  const [rows, [{ count }]] = await Promise.all([
    db
      .select(listColumns)
      .from(projects)
      .where(and(...where))
      .orderBy(...order)
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ count: sql<number>`count(*)::int` }).from(projects).where(and(...where)),
  ]);
  return { rows: rows as ProjectListItem[], total: count, page, limit, sort };
}

// Playground: listed, active Autonomo gateways that accept $AUTONOMO, best match first.
async function findAutonomoGatewaysFresh(keywords: string[], limit = 3) {
  const db = await getDb();
  if (!keywords.length) return [];
  const { gateways } = schema;
  const tsq = sql`websearch_to_tsquery('english', ${keywords.join(" or ")})`;
  const text = sql`to_tsvector('english', ${gateways.name} || ' ' || ${gateways.description})`;
  return db
    .select({
      slug: gateways.slug,
      name: gateways.name,
      description: gateways.description,
      autonomoAmount: gateways.autonomoAmount,
      projectSlug: projects.slug,
    })
    .from(gateways)
    .innerJoin(projects, eq(gateways.projectId, projects.id))
    .where(
      and(
        eq(gateways.listing, "listed"),
        eq(gateways.status, "active"),
        eq(projects.status, "approved"),
        sql`${gateways.autonomoAmount} is not null`,
        or(sql`${projects.search} @@ ${tsq}`, sql`${text} @@ ${tsq}`),
      ),
    )
    .orderBy(sql`greatest(ts_rank(${projects.search}, ${tsq}), ts_rank(${text}, ${tsq})) desc`, desc(projects.calls30d))
    .limit(limit);
}

// Playground: every listed, active Autonomo gateway the agent can pay in $AUTONOMO right now.
async function listAutonomoGatewaysFresh() {
  const db = await getDb();
  const { gateways } = schema;
  return db
    .select({
      slug: gateways.slug,
      name: gateways.name,
      description: gateways.description,
      autonomoAmount: gateways.autonomoAmount,
      priceUsd: gateways.priceUsd,
      acceptUsdg: gateways.acceptUsdg,
      projectSlug: projects.slug,
    })
    .from(gateways)
    .innerJoin(projects, eq(gateways.projectId, projects.id))
    .where(
      and(
        eq(gateways.listing, "listed"),
        eq(gateways.status, "active"),
        eq(projects.status, "approved"),
        sql`${gateways.autonomoAmount} is not null`,
      ),
    )
    .orderBy(asc(gateways.createdAt));
}

// Listed, active gateways whose paid wallet holds the Verified amount. A failed read throws, so it isn't cached.
async function verifiedGatewaysFresh() {
  const db = await getDb();
  const { gateways } = schema;
  const rows = await db
    .select({ slug: gateways.slug, holder: sql<string>`coalesce(${gateways.payTo}, ${gateways.owner})`, projectSlug: projects.slug })
    .from(gateways)
    .innerJoin(projects, eq(gateways.projectId, projects.id))
    .where(and(eq(gateways.listing, "listed"), eq(gateways.status, "active"), eq(projects.status, "approved")));
  const holders = [...new Set(rows.map((r) => r.holder))];
  const holds = new Map(await Promise.all(holders.map(async (h) => [h, await holdsMinimum(h)] as const)));
  const verified = rows.filter((r) => holds.get(r.holder));
  return { slugs: verified.map((r) => r.slug), projectSlugs: verified.map((r) => r.projectSlug) };
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function getProjectFresh(slug: string) {
  const db = await getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.status, "approved")))
    .limit(1);
  if (!project) return null;
  const eps = await db
    .select({
      id: endpoints.id,
      url: endpoints.url,
      method: endpoints.method,
      description: endpoints.description,
      network: endpoints.network,
      priceUsd: endpoints.priceUsd,
      amount: endpoints.amount,
      asset: endpoints.asset,
      scheme: endpoints.scheme,
      facilitator: endpoints.facilitator,
      x402Version: endpoints.x402Version,
      calls30d: endpoints.calls30d,
      payers30d: endpoints.payers30d,
      lastCalledAt: endpoints.lastCalledAt,
    })
    .from(endpoints)
    .where(eq(endpoints.projectId, project.id))
    .orderBy(desc(endpoints.calls30d), asc(endpoints.url))
    .limit(500);
  return { project, endpoints: eps };
}

async function getStatsFresh() {
  const db = await getDb();
  const [[totals], categories, networks] = await Promise.all([
    db
      .select({
        projects: sql<number>`count(*)::int`,
        endpoints: sql<number>`coalesce(sum(${projects.endpointCount}), 0)::int`,
        calls30d: sql<number>`coalesce(sum(${projects.calls30d}), 0)::bigint`,
      })
      .from(projects)
      .where(eq(projects.status, "approved")),
    db
      .select({ category: projects.category, count: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.status, "approved"))
      .groupBy(projects.category),
    db.execute<{ network: string; count: number }>(sql`
      select n as network, count(*)::int as count
      from ${projects}, unnest(${projects.networks}) as n
      where ${projects.status} = 'approved'
      group by n order by count desc`),
  ]);
  const networkRows = "rows" in networks ? networks.rows : (networks as unknown as { network: string; count: number }[]);
  // The 12 most common, plus Autonomo's own chain wherever it ranks.
  const topNetworks = networkRows.filter((n, i) => i < 12 || n.network === TOKEN.network);
  return {
    projects: totals.projects,
    endpoints: totals.endpoints,
    calls30d: Number(totals.calls30d),
    categories: Object.fromEntries(categories.map((c) => [c.category, c.count])) as Partial<Record<Category, number>>,
    networks: topNetworks,
  };
}

async function getFeaturedFresh(category?: Category, limit = 8) {
  const db = await getDb();
  const where = [eq(projects.status, "approved")];
  if (category) where.push(eq(projects.category, category));
  return (await db
    .select(listColumns)
    .from(projects)
    .where(and(...where))
    .orderBy(desc(projects.featured), desc(projects.calls30d), asc(projects.name))
    .limit(limit)) as ProjectListItem[];
}

async function getAllSlugsFresh() {
  const db = await getDb();
  return db
    .select({ slug: projects.slug, updatedAt: projects.updatedAt })
    .from(projects)
    .where(eq(projects.status, "approved"))
    .orderBy(desc(projects.calls30d))
    .limit(10000);
}

// The track record of every listed, active gateway, from its paid calls in the last TRACK_RECORD_DAYS days.
async function trackRecordsFresh() {
  const db = await getDb();
  const { gateways, gatewayCalls } = schema;
  const since = sql`now() - make_interval(days => ${TRACK_RECORD_DAYS})`;
  const live = and(eq(gateways.listing, "listed"), eq(gateways.status, "active"), eq(projects.status, "approved"));
  const [rows, totals, payers] = await Promise.all([
    db
      .select({
        id: gateways.id,
        slug: gateways.slug,
        name: gateways.name,
        owner: gateways.owner,
        payTo: gateways.payTo,
        createdAt: gateways.createdAt,
        projectSlug: projects.slug,
      })
      .from(gateways)
      .innerJoin(projects, eq(gateways.projectId, projects.id))
      .where(live),
    db
      .select({
        gatewayId: gatewayCalls.gatewayId,
        attempts: sql<number>`count(*) filter (where ${gatewayCalls.createdAt} >= ${since} and ${gatewayCalls.status} <> 402)::int`,
        answered: sql<number>`count(*) filter (where ${gatewayCalls.createdAt} >= ${since} and ${gatewayCalls.status} <> 402 and ${gatewayCalls.status} < 500)::int`,
        medianMs: sql<number | null>`percentile_cont(0.5) within group (order by ${gatewayCalls.latencyMs}) filter (where ${gatewayCalls.createdAt} >= ${since} and ${gatewayCalls.settled})`,
        settled: sql<number>`count(*) filter (where ${gatewayCalls.createdAt} >= ${since} and ${gatewayCalls.settled})::int`,
        refused: sql<number>`count(*) filter (where ${gatewayCalls.createdAt} >= ${since} and ${gatewayCalls.status} = 402)::int`,
        failed: sql<number>`count(*) filter (where ${gatewayCalls.createdAt} >= ${since} and ${gatewayCalls.status} >= 500)::int`,
        settledAllTime: sql<number>`count(*) filter (where ${gatewayCalls.settled})::int`,
      })
      .from(gatewayCalls)
      .groupBy(gatewayCalls.gatewayId),
    db
      .select({
        gatewayId: gatewayCalls.gatewayId,
        payer: gatewayCalls.payer,
        days: sql<number>`count(distinct date_trunc('day', ${gatewayCalls.createdAt} at time zone 'UTC'))::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(gatewayCalls)
      .where(and(gte(gatewayCalls.createdAt, since), eq(gatewayCalls.settled, true), sql`${gatewayCalls.payer} is not null`))
      .groupBy(gatewayCalls.gatewayId, gatewayCalls.payer),
  ]);
  const out: Record<string, TrackRecord & { gatewaySlug: string; name: string; owner: string; projectSlug: string }> = {};
  for (const g of rows) {
    const t = totals.find((x) => x.gatewayId === g.id);
    const record = summarize(
      g,
      {
        attempts: t?.attempts ?? 0,
        answered: t?.answered ?? 0,
        medianMs: t?.medianMs == null ? null : Number(t.medianMs),
        settled: t?.settled ?? 0,
        refused: t?.refused ?? 0,
        failed: t?.failed ?? 0,
        settledAllTime: t?.settledAllTime ?? 0,
      },
      payers.filter((p) => p.gatewayId === g.id).map((p) => ({ payer: p.payer!, days: p.days, calls: p.calls })),
    );
    out[g.slug] = { ...record, gatewaySlug: g.slug, name: g.name, owner: g.owner, projectSlug: g.projectSlug };
  }
  return out;
}

// ---------- cached reads ----------
// Every page view and API call used to query the database, which kept it awake around the clock. These reads are
// cached (shared across server instances), so most requests never reach it. Admin changes and the directory refresh
// (every 3 days) clear the tags (see revalidateCatalog), so directory reads can live a day; gateway lists refresh sooner.

const DAY = 24 * 3600;

export const CATALOG_TAGS = { directory: "directory", gateways: "gateways" } as const;

function cachedRead<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string, seconds: number, tag: string) {
  const read = unstable_cache(fn, [key], { revalidate: seconds, tags: [tag] });
  return async (...args: A) => {
    await connection();
    return read(...args);
  };
}

export const searchProjects = cachedRead(searchProjectsFresh, "search-projects", DAY, CATALOG_TAGS.directory);
export const getStats = cachedRead(getStatsFresh, "stats", DAY, CATALOG_TAGS.directory);
export const getFeatured = cachedRead(getFeaturedFresh, "featured", DAY, CATALOG_TAGS.directory);
export const getAllSlugs = cachedRead(getAllSlugsFresh, "all-slugs", DAY, CATALOG_TAGS.directory);
export const getProject = cache(cachedRead(getProjectFresh, "project", DAY, CATALOG_TAGS.directory));
export const listAutonomoGateways = cachedRead(listAutonomoGatewaysFresh, "autonomo-gateways", 300, CATALOG_TAGS.gateways);
/** Track records keyed by gateway slug, refreshed hourly so page views don't keep the database awake. */
export const getTrackRecords = cachedRead(trackRecordsFresh, "track-records", 3600, CATALOG_TAGS.gateways);
const verifiedGatewaysCached = cachedRead(verifiedGatewaysFresh, "verified-gateways", 300, CATALOG_TAGS.gateways);

/** Slugs of Verified gateways and their projects; empty while balances can't be read, so a badge never blocks a page. */
export const getVerifiedGateways = cache(async () => {
  try {
    return await verifiedGatewaysCached();
  } catch (e) {
    console.error("verified gateways failed", e);
    return { slugs: [] as string[], projectSlugs: [] as string[] };
  }
});
export const findAutonomoGateways = cachedRead(findAutonomoGatewaysFresh, "find-autonomo-gateways", 300, CATALOG_TAGS.gateways);

/** Drop cached catalog reads now (after admin changes, gateway edits and the directory refresh). */
export function revalidateCatalog() {
  revalidateTag(CATALOG_TAGS.directory, { expire: 0 });
  revalidateTag(CATALOG_TAGS.gateways, { expire: 0 });
}
