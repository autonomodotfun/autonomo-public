import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { JUNK_HOST, toRow, type Accept, type EndpointRow, type Item } from "./bazaar-import";
import { networkLabel } from "@/lib/payments/networks";

// Attaches an x402 endpoint to a directory listing from /admin, from what the endpoint itself answers: its 402 says
// the price, the chains, the token and who gets paid, so nothing is typed in by hand. For listings that come from a
// submission, which only carry a name, a description and links, and for APIs that aren't in the Coinbase or PayAI
// catalogs. Autonomo gateways manage their own endpoint.

// The facilitator column for endpoints read this way: nobody settled a payment for them yet, the API told us.
export const DIRECT = "direct";

// Private and link-local addresses, never fetched from the server.
const PRIVATE_HOST = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|\[?::1?\]?$|\[?f[cd][0-9a-f]{2}:)/i;

export type ReadResult =
  | { ok: true; url: string; method: string; description: string; networks: string[]; priceUsd: string | null; payTo: string | null; row: EndpointRow }
  | { ok: false; error: string };

type PaymentRequired = {
  x402Version?: number;
  resource?: { url?: string; description?: string } | string;
  description?: string;
  accepts?: Accept[];
  extensions?: Item["extensions"];
};

function decodeHeader(value: string | null): PaymentRequired | null {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** The endpoint address as listed: no query string, so an example call's values aren't stored as the endpoint. */
function listedUrl(raw: string): string {
  const u = new URL(raw);
  u.search = "";
  u.hash = "";
  return u.toString();
}

/** Calls the endpoint without paying and reads its 402. `probe` may carry example query values so it answers 402. */
export async function readEndpoint(probe: string, method = "GET"): Promise<ReadResult> {
  let url: URL;
  try {
    url = new URL(probe.trim());
  } catch {
    return { ok: false, error: "That isn't a valid URL." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Use an https:// address." };
  if (JUNK_HOST.test(url.hostname) || PRIVATE_HOST.test(url.hostname)) return { ok: false, error: "That host can't be listed." };
  method = method.toUpperCase() === "POST" ? "POST" : "GET";

  let res: Response;
  try {
    res = await fetch(url, { method, redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    return { ok: false, error: `It didn't answer: ${(err as Error).message}` };
  }
  if (res.status !== 402) {
    return { ok: false, error: `It answered ${res.status}, not 402. Add example query values if it needs them to ask for payment.` };
  }
  // x402 v2 puts the requirements in a header; v1 puts them in the body.
  let required = decodeHeader(res.headers.get("payment-required"));
  if (!required?.accepts?.length) required = (await res.json().catch(() => null)) as PaymentRequired | null;
  if (!required?.accepts?.length) return { ok: false, error: "Its 402 doesn't list any way to pay." };

  // The resource it names must be on the same host we called, so a 402 can't file itself under someone else.
  const named = typeof required.resource === "string" ? required.resource : required.resource?.url;
  let resource = url.toString();
  try {
    if (named && new URL(named).hostname === url.hostname) resource = named;
  } catch {
    // Not a URL: keep the one we called.
  }
  const resourceDescription = typeof required.resource === "object" ? required.resource?.description : undefined;
  const row = toRow(
    {
      resource: listedUrl(resource),
      x402Version: required.x402Version,
      description: resourceDescription ?? required.description ?? null,
      accepts: required.accepts,
      extensions: required.extensions,
    },
    DIRECT,
  );
  if (!row) return { ok: false, error: "That address can't be listed." };
  row.method = method;
  return { ok: true, url: row.url, method, description: row.description ?? "", networks: row.networks, priceUsd: row.priceUsd ?? null, payTo: row.payTo ?? null, row };
}

/** Refreshes a listing's endpoint count, lowest price and chains from its endpoints. `add` adds chains read just now,
 * since an endpoint row keeps only the first chain it's paid on. */
async function refreshListing(projectId: number, add: string[] = []) {
  const db = await getDb();
  const [stats] = await db
    .select({
      n: sql<number>`count(*)::int`,
      min: sql<string | null>`min(${schema.endpoints.priceUsd})::text`,
      chains: sql<string[]>`coalesce(array_agg(distinct ${schema.endpoints.network}) filter (where ${schema.endpoints.network} is not null), '{}')`,
    })
    .from(schema.endpoints)
    .where(eq(schema.endpoints.projectId, projectId));
  const [p] = await db.select({ networks: schema.projects.networks }).from(schema.projects).where(eq(schema.projects.id, projectId));
  // With no endpoints left, the chains go too. Otherwise keep the chains already known and add any new ones.
  const networks = stats.n === 0 ? [] : [...new Set([...(p?.networks ?? []), ...stats.chains, ...add])];
  await db
    .update(schema.projects)
    .set({ endpointCount: stats.n, minPriceUsd: stats.min, networks, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
}

// `move` is set when the endpoint was added to another listing here, so it can be moved to this one instead.
export type AttachResult = { ok: true; message: string } | { ok: false; error: string; move?: { url: string; method: string } };

/** Reads the endpoint's 402 and adds it to the listing, or refreshes it if it's already there. */
export async function attachEndpoint(slug: string, probe: string, method = "GET"): Promise<AttachResult> {
  const db = await getDb();
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.slug, slug.trim())).limit(1);
  if (!project) return { ok: false, error: `No listing at /projects/${slug}.` };
  if (project.source === "gateway") return { ok: false, error: "That's an Autonomo gateway: its endpoint is managed by the gateway itself." };

  const read = await readEndpoint(probe, method);
  if (!read.ok) return read;
  const { host, serviceName: _s, networks: _n, ...row } = read.row;

  const [taken] = await db
    .select({ projectId: schema.endpoints.projectId, slug: schema.projects.slug, facilitator: schema.endpoints.facilitator })
    .from(schema.endpoints)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.endpoints.projectId))
    .where(and(eq(schema.endpoints.url, row.url), eq(schema.endpoints.method, row.method!), ne(schema.endpoints.projectId, project.id)))
    .limit(1);
  if (taken) {
    const movable = taken.facilitator === DIRECT;
    return {
      ok: false,
      error: `${row.method} ${row.url} is already listed under /projects/${taken.slug}.${movable ? " If it belongs here, move it." : ""}`,
      move: movable ? { url: row.url, method: row.method! } : undefined,
    };
  }

  const now = new Date();
  await db
    .insert(schema.endpoints)
    .values({ ...row, projectId: project.id, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.endpoints.url, schema.endpoints.method],
      set: {
        description: sql`excluded.description`,
        network: sql`excluded.network`,
        asset: sql`excluded.asset`,
        amount: sql`excluded.amount`,
        priceUsd: sql`excluded.price_usd`,
        payTo: sql`excluded.pay_to`,
        scheme: sql`excluded.scheme`,
        x402Version: sql`excluded.x402_version`,
        bazaarInfo: sql`excluded.bazaar_info`,
        updatedAt: now,
      },
    });

  // File the listing under the endpoint's host, so a later Coinbase or PayAI import fills in this listing instead of
  // making a second one. Only when the listing has no host yet and no other listing has this one.
  if (!project.host) {
    const [other] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.host, host)).limit(1);
    if (!other) await db.update(schema.projects).set({ host }).where(eq(schema.projects.id, project.id));
  }
  await refreshListing(project.id, read.networks);

  const price = read.priceUsd === null ? "price not in dollars" : `$${Number(read.priceUsd)}`;
  return { ok: true, message: `${read.method} ${read.url} attached to /projects/${project.slug}: ${price}, paid to ${read.payTo ?? "?"} on ${read.networks.map(networkLabel).join(", ")}.` };
}

/** Moves an endpoint added here from the listing it's on to `slug`, for one filed under the wrong listing. The domain
 * goes with it when the old listing has nothing else left on that domain. */
export async function moveEndpoint(slug: string, url: string, method: string): Promise<AttachResult> {
  const db = await getDb();
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.slug, slug.trim())).limit(1);
  if (!project) return { ok: false, error: `No listing at /projects/${slug}.` };
  if (project.source === "gateway") return { ok: false, error: "That's an Autonomo gateway: its endpoint is managed by the gateway itself." };
  const [endpoint] = await db
    .select({ id: schema.endpoints.id, projectId: schema.endpoints.projectId, network: schema.endpoints.network })
    .from(schema.endpoints)
    .where(and(eq(schema.endpoints.url, url), eq(schema.endpoints.method, method), eq(schema.endpoints.facilitator, DIRECT)))
    .limit(1);
  if (!endpoint) return { ok: false, error: "That endpoint isn't one added here." };
  if (endpoint.projectId === project.id) return { ok: true, message: `${method} ${url} is already on /projects/${project.slug}.` };
  const [from] = await db.select({ slug: schema.projects.slug, host: schema.projects.host }).from(schema.projects).where(eq(schema.projects.id, endpoint.projectId));

  await db.update(schema.endpoints).set({ projectId: project.id, updatedAt: new Date() }).where(eq(schema.endpoints.id, endpoint.id));
  const host = new URL(url).hostname.toLowerCase();
  if (from?.host === host) {
    const left = await db.select({ url: schema.endpoints.url }).from(schema.endpoints).where(eq(schema.endpoints.projectId, endpoint.projectId));
    if (!left.some((e) => new URL(e.url).hostname.toLowerCase() === host)) {
      await db.update(schema.projects).set({ host: null }).where(eq(schema.projects.id, endpoint.projectId));
      if (!project.host) await db.update(schema.projects).set({ host }).where(eq(schema.projects.id, project.id));
    }
  }
  // An endpoint row keeps only its first chain, so ask the endpoint again for all of them. If it won't answer without
  // example values, its first chain is used.
  const again = await readEndpoint(url, method);
  await refreshListing(endpoint.projectId);
  await refreshListing(project.id, again.ok ? again.networks : endpoint.network ? [endpoint.network] : []);
  return { ok: true, message: `${method} ${url} moved from /projects/${from?.slug ?? "?"} to /projects/${project.slug}.` };
}

/** Removes one endpoint from a listing. Only endpoints read from a 402 here, so imported ones stay with their import. */
export async function detachEndpoint(slug: string, endpointId: number): Promise<AttachResult> {
  const db = await getDb();
  const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, slug.trim())).limit(1);
  if (!project) return { ok: false, error: `No listing at /projects/${slug}.` };
  const removed = await db
    .delete(schema.endpoints)
    .where(and(eq(schema.endpoints.id, endpointId), eq(schema.endpoints.projectId, project.id), eq(schema.endpoints.facilitator, DIRECT)))
    .returning({ url: schema.endpoints.url, method: schema.endpoints.method });
  if (!removed.length) return { ok: false, error: "That endpoint isn't one added here." };
  await refreshListing(project.id);
  return { ok: true, message: `${removed[0].method} ${removed[0].url} removed from /projects/${slug}.` };
}

/** The endpoints a listing has, for the admin form. */
export async function listingEndpoints(slug: string) {
  const db = await getDb();
  const [project] = await db
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      name: schema.projects.name,
      source: schema.projects.source,
      networks: schema.projects.networks,
      description: schema.projects.description,
      website: schema.projects.website,
      docs: schema.projects.docs,
      github: schema.projects.github,
      twitter: schema.projects.twitter,
      logoUrl: schema.projects.logoUrl,
    })
    .from(schema.projects)
    .where(eq(schema.projects.slug, slug.trim()))
    .limit(1);
  if (!project) return null;
  const endpoints = await db
    .select({
      id: schema.endpoints.id,
      url: schema.endpoints.url,
      method: schema.endpoints.method,
      priceUsd: schema.endpoints.priceUsd,
      network: schema.endpoints.network,
      payTo: schema.endpoints.payTo,
      facilitator: schema.endpoints.facilitator,
    })
    .from(schema.endpoints)
    .where(eq(schema.endpoints.projectId, project.id));
  return { project, endpoints };
}
