import "server-only";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { CATEGORIES, type Category } from "@/db/schema";
import { TESTNET_PATTERN } from "@/lib/networks";
import { holdsMinimum } from "@/lib/verified";

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

export type EndpointQuery = {
  q?: string;
  network?: string;
  maxPriceUsd?: number;
  sort: "popular" | "price";
  page: number;
  limit: number;
};

export function parseEndpointQuery(params: URLSearchParams): EndpointQuery {
  const one = (k: string) => params.get(k)?.trim() || undefined;
  const page = Number(one("page") ?? 1);
  const limit = Number(one("limit") ?? 50);
  const maxPrice = Number(one("maxPrice"));
  return {
    q: one("q")?.slice(0, 100),
    network: one("network")?.toLowerCase().slice(0, 40),
    maxPriceUsd: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined,
    sort: one("sort") === "price" ? "price" : "popular",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 1000) : 1,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50,
  };
}

// Endpoint-level search across the whole catalog (paid tier): callable URLs with price and payment details.
async function searchEndpointsFresh(query: EndpointQuery) {
  const db = await getDb();
  const { q, network, maxPriceUsd, sort, page, limit } = query;

  // Agents pay real money here, so testnet endpoints are left out.
  const where: SQL[] = [
    eq(projects.status, "approved"),
    sql`coalesce(${endpoints.network}, '') !~* ${TESTNET_PATTERN}`,
  ];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      or(
        sql`${projects.search} @@ websearch_to_tsquery('english', ${q})`,
        ilike(endpoints.description, like),
        ilike(endpoints.url, like),
      )!,
    );
  }
  if (network) where.push(eq(sql`lower(${endpoints.network})`, network));
  if (maxPriceUsd !== undefined) where.push(sql`${endpoints.priceUsd} <= ${maxPriceUsd}`);

  const order =
    sort === "price"
      ? [sql`${endpoints.priceUsd} asc nulls last`, desc(endpoints.calls30d)]
      : [desc(endpoints.calls30d), sql`${endpoints.priceUsd} asc nulls last`];

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        url: endpoints.url,
        method: endpoints.method,
        description: endpoints.description,
        network: endpoints.network,
        priceUsd: endpoints.priceUsd,
        amount: endpoints.amount,
        asset: endpoints.asset,
        payTo: endpoints.payTo,
        scheme: endpoints.scheme,
        facilitator: endpoints.facilitator,
        x402Version: endpoints.x402Version,
        calls30d: endpoints.calls30d,
        payers30d: endpoints.payers30d,
        lastCalledAt: endpoints.lastCalledAt,
        project: { slug: projects.slug, name: projects.name, website: projects.website },
      })
      .from(endpoints)
      .innerJoin(projects, eq(endpoints.projectId, projects.id))
      .where(and(...where))
      .orderBy(...order, asc(endpoints.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(endpoints)
      .innerJoin(projects, eq(endpoints.projectId, projects.id))
      .where(and(...where)),
  ]);
  return { rows, total: count, page, limit, sort };
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

// Listed, active gateways whose owner holds the Verified minimum. A failed balance read throws, so it isn't cached.
async function verifiedGatewaysFresh() {
  const db = await getDb();
  const { gateways } = schema;
  const rows = await db
    .select({ slug: gateways.slug, owner: gateways.owner, projectSlug: projects.slug })
    .from(gateways)
    .innerJoin(projects, eq(gateways.projectId, projects.id))
    .where(and(eq(gateways.listing, "listed"), eq(gateways.status, "active"), eq(projects.status, "approved")));
  const owners = [...new Set(rows.map((r) => r.owner))];
  const holds = new Map(await Promise.all(owners.map(async (o) => [o, await holdsMinimum(o)] as const)));
  const verified = rows.filter((r) => holds.get(r.owner));
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
      group by n order by count desc limit 12`),
  ]);
  const networkRows = "rows" in networks ? networks.rows : (networks as unknown as { network: string; count: number }[]);
  return {
    projects: totals.projects,
    endpoints: totals.endpoints,
    calls30d: Number(totals.calls30d),
    categories: Object.fromEntries(categories.map((c) => [c.category, c.count])) as Partial<Record<Category, number>>,
    networks: networkRows,
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
export const searchEndpoints = cachedRead(searchEndpointsFresh, "search-endpoints", DAY, CATALOG_TAGS.directory);
export const getStats = cachedRead(getStatsFresh, "stats", DAY, CATALOG_TAGS.directory);
export const getFeatured = cachedRead(getFeaturedFresh, "featured", DAY, CATALOG_TAGS.directory);
export const getAllSlugs = cachedRead(getAllSlugsFresh, "all-slugs", DAY, CATALOG_TAGS.directory);
export const getProject = cache(cachedRead(getProjectFresh, "project", DAY, CATALOG_TAGS.directory));
export const listAutonomoGateways = cachedRead(listAutonomoGatewaysFresh, "autonomo-gateways", 300, CATALOG_TAGS.gateways);
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
