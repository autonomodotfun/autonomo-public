import "server-only";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { CATEGORIES, type Category } from "@/db/schema";
import { TESTNET_PATTERN } from "@/lib/networks";

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

export async function searchProjects(query: ProjectQuery) {
  await connection();
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
export async function searchEndpoints(query: EndpointQuery) {
  await connection();
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

// Playground: the best-matching paid endpoints for a set of keywords, Autonomo gateways first.
export async function findEndpointsForKeywords(keywords: string[], limit = 3) {
  await connection();
  const db = await getDb();
  if (!keywords.length) return [];
  const tsq = sql`websearch_to_tsquery('english', ${keywords.join(" or ")})`;
  return db
    .select({
      url: endpoints.url,
      method: endpoints.method,
      description: endpoints.description,
      network: endpoints.network,
      priceUsd: endpoints.priceUsd,
      facilitator: endpoints.facilitator,
      project: { slug: projects.slug, name: projects.name, description: projects.description },
    })
    .from(endpoints)
    .innerJoin(projects, eq(endpoints.projectId, projects.id))
    .where(
      and(
        eq(projects.status, "approved"),
        sql`coalesce(${endpoints.network}, '') !~* ${TESTNET_PATTERN}`,
        sql`upper(coalesce(${endpoints.method}, 'GET')) = 'GET'`,
        sql`${projects.search} @@ ${tsq}`,
      ),
    )
    .orderBy(
      sql`(${endpoints.facilitator} = 'autonomo') desc nulls last`,
      sql`ts_rank(${projects.search}, ${tsq}) desc`,
      desc(endpoints.calls30d),
      asc(endpoints.id),
    )
    .limit(limit);
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const getProject = cache(async (slug: string) => {
  await connection();
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
});

export async function getStats() {
  await connection();
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

export async function getFeatured(category?: Category, limit = 8) {
  await connection();
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

export async function getAllSlugs() {
  await connection();
  const db = await getDb();
  return db
    .select({ slug: projects.slug, updatedAt: projects.updatedAt })
    .from(projects)
    .where(eq(projects.status, "approved"))
    .orderBy(desc(projects.calls30d))
    .limit(10000);
}
