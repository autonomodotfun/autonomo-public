import { sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { isTestnet, normalizeNetwork, priceUsd } from "./networks";
import { displayHost, slugify } from "./slug";

// Imports x402 resources from facilitator discovery ("Bazaar") endpoints and groups them into projects by host.
// Used by `npm run db:import` and by the cron (every 3 days) at /api/cron/import. Existing projects keep their curated
// name, category and status; stats, prices and imported descriptions are refreshed.

const SOURCES = [
  { facilitator: "cdp", url: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources" },
  { facilitator: "payai", url: "https://facilitator.payai.network/discovery/resources" },
];

const PAGE = 1000;

// Hosts that are tunnels, previews or local addresses: not real listings.
const JUNK_HOST = /(^localhost$|^\d+\.\d+\.\d+\.\d+$|ngrok|trycloudflare\.com$|loca\.lt$|localtunnel|\.local$|webhook\.site$|example\.(com|org)$)/i;

type Accept = {
  network?: string;
  asset?: string;
  amount?: string;
  maxAmountRequired?: string;
  payTo?: string;
  scheme?: string;
  description?: string;
  extra?: { name?: unknown; decimals?: unknown } | null;
  outputSchema?: { input?: { method?: string } };
};

type Item = {
  resource: string;
  type?: string;
  x402Version?: number;
  description?: string | null;
  serviceName?: string | null;
  tags?: string[] | null;
  lastUpdated?: string;
  metadata?: { description?: string } | null;
  accepts?: Accept[];
  extensions?: { bazaar?: { info?: { input?: { method?: string } } & Record<string, unknown> } };
  quality?: { l30DaysTotalCalls?: number; l30DaysUniquePayers?: number; lastCalledAt?: string };
};

async function fetchJson(url: string, attempt = 1): Promise<{ items: Item[]; pagination?: { total?: number } }> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return res.json() as never;
}

async function* pages(base: string, max: number, log: (s: string) => void) {
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < max) {
    const data = await fetchJson(`${base}?limit=${PAGE}&offset=${offset}`);
    total = data.pagination?.total ?? 0;
    if (!data.items?.length) break;
    yield data.items;
    offset += data.items.length;
  }
  log(`  ${Math.min(offset, total)}/${total === Infinity ? "?" : total} fetched`);
}

// `network` is the first payment option, which the price and payment details come from. `networks` is every option.
type EndpointRow = Omit<typeof schema.endpoints.$inferInsert, "projectId"> & {
  host: string;
  serviceName: string | null;
  networks: string[];
};

// Postgres text/jsonb reject NUL characters, which a few listings contain.
function clean<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\u0000/g, "") as T;
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [clean(k), clean(v)])) as T;
  }
  return value;
}

function toRow(raw: Item, facilitator: string): EndpointRow | null {
  const item = clean(raw);
  let url: URL;
  try {
    url = new URL(item.resource);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || JUNK_HOST.test(url.hostname)) return null;
  const accept = item.accepts?.[0];
  const amount = accept?.amount ?? accept?.maxAmountRequired ?? null;
  const method =
    item.extensions?.bazaar?.info?.input?.method ?? accept?.outputSchema?.input?.method ?? "GET";
  const info = item.extensions?.bazaar?.info;
  const infoJson = info ? JSON.stringify(info) : null;
  const usd = priceUsd(amount, accept?.asset, accept?.extra);
  return {
    host: url.hostname.toLowerCase(),
    serviceName: item.serviceName?.trim() || null,
    url: item.resource,
    method: method.toUpperCase(),
    type: item.type ?? "http",
    description: (item.description ?? item.metadata?.description ?? accept?.description ?? "").trim().slice(0, 1000),
    network: normalizeNetwork(accept?.network),
    networks: [...new Set((item.accepts ?? []).map((a) => normalizeNetwork(a.network)).filter((n): n is string => !!n))],
    asset: accept?.asset ?? null,
    amount,
    priceUsd: usd === null ? null : String(usd),
    payTo: accept?.payTo ?? null,
    scheme: accept?.scheme ?? null,
    facilitator,
    x402Version: item.x402Version ?? null,
    tags: (item.tags ?? []).filter((t) => typeof t === "string").slice(0, 10),
    bazaarInfo: infoJson && infoJson.length <= 8000 ? info : null,
    calls30d: item.quality?.l30DaysTotalCalls ?? 0,
    payers30d: item.quality?.l30DaysUniquePayers ?? 0,
    lastCalledAt: item.quality?.lastCalledAt ? new Date(item.quality.lastCalledAt) : null,
    sourceUpdatedAt: item.lastUpdated ? new Date(item.lastUpdated) : null,
  };
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function mostCommonTags(tags: string[]): string[] {
  const counts = new Map<string, number>();
  for (const t of tags) {
    const k = t.toLowerCase().trim();
    if (k && k.length <= 30) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}


export type ImportOptions = { dryRun?: boolean; max?: number; log?: (line: string) => void };

export async function importBazaar({ dryRun = false, max = Infinity, log = console.log }: ImportOptions = {}) {
  // --- Fetch -------------------------------------------------------------------
  const byKey = new Map<string, EndpointRow>();
  const failures: string[] = [];
  for (const source of SOURCES) {
    log(`Fetching ${source.facilitator}…`);
    try {
      for await (const items of pages(source.url, max, log)) {
        for (const item of items) {
          const row = toRow(item, source.facilitator);
          if (!row) continue;
          const key = `${row.method} ${row.url}`;
          const prev = byKey.get(key);
          // Same resource listed by several facilitators: keep the one with more usage data, and every network from both.
          const networks = [...new Set([...(prev?.networks ?? []), ...row.networks])];
          if (!prev || (row.calls30d ?? 0) > (prev.calls30d ?? 0)) byKey.set(key, { ...row, networks });
          else prev.networks = networks;
        }
      }
    } catch (err) {
      log(`  ${source.facilitator} failed: ${(err as Error).message}`);
      failures.push(source.facilitator);
    }
  }

  // --- Group by host ---------------------------------------------------------------
  type Group = { host: string; rows: EndpointRow[] };
  const groups = new Map<string, Group>();
  for (const row of byKey.values()) {
    const g = groups.get(row.host) ?? { host: row.host, rows: [] };
    g.rows.push(row);
    groups.set(row.host, g);
  }


  const projectRows = [...groups.values()].map(({ host, rows }) => {
    rows.sort((a, b) => (b.calls30d ?? 0) - (a.calls30d ?? 0));
    const networks = [...new Set(rows.flatMap((r) => r.networks))];
    const tagCounts = mostCommonTags(rows.flatMap((r) => r.tags ?? []));
    const prices = rows.map((r) => (r.priceUsd ? Number(r.priceUsd) : null)).filter((p): p is number => p !== null);
    const name = mostCommon(rows.map((r) => r.serviceName)) ?? displayHost(host);
    // The busiest endpoint is often a ping; prefer the most descriptive text among the top few.
    const top =
      rows
        .slice(0, 5)
        .map((r) => r.description ?? "")
        .sort((a, b) => b.length - a.length)[0] ?? "";
    const testnetOnly = networks.length > 0 && networks.every(isTestnet);
    return {
      host,
      name: name.slice(0, 80),
      description: top.slice(0, 400),
      category: "service" as const,
      website: `https://${host}`,
      tags: tagCounts,
      networks,
      status: testnetOnly ? ("hidden" as const) : ("approved" as const),
      source: `bazaar:${mostCommon(rows.map((r) => r.facilitator))}`,
      endpointCount: rows.length,
      calls30d: rows.reduce((s, r) => s + (r.calls30d ?? 0), 0),
      payers30d: Math.max(0, ...rows.map((r) => r.payers30d ?? 0)),
      minPriceUsd: prices.length ? String(Math.min(...prices)) : null,
      rows,
    };
  });


  const live = projectRows.filter((p) => p.status === "approved");
  log(
    `${byKey.size} endpoints across ${projectRows.length} hosts (${live.length} with mainnet endpoints, ${
      projectRows.length - live.length
    } testnet-only → hidden).`,
  );
  const summary = { endpoints: byKey.size, hosts: projectRows.length, live: live.length, failures, written: 0 };
  if (dryRun) {
    log("Top 25 by 30-day calls:");
    for (const p of [...live].sort((a, b) => b.calls30d - a.calls30d).slice(0, 25)) {
      log(`  ${p.calls30d.toString().padStart(8)}  ${p.endpointCount.toString().padStart(4)} eps  ${p.name}  (${p.host})`);
    }
    return summary;
  }
  // Never overwrite the catalog with a partial import: if a source failed and nothing came back, stop here.
  if (byKey.size === 0) throw new Error(`Import fetched nothing (failed: ${failures.join(", ") || "none"}); database left unchanged.`);

  // --- Write ---------------------------------------------------------------------
  const db = await getDb();
  const existing = await db
    .select({ slug: schema.projects.slug, host: schema.projects.host })
    .from(schema.projects);
  const usedSlugs = new Set(existing.map((e) => e.slug));
  const slugByHost = new Map(existing.filter((e) => e.host).map((e) => [e.host!, e.slug]));

  function uniqueSlug(name: string, host: string): string {
    const known = slugByHost.get(host);
    if (known) return known;
    let base = slugify(name);
    if (usedSlugs.has(base)) base = slugify(`${name}-${displayHost(host)}`);
    let slug = base;
    for (let i = 2; usedSlugs.has(slug); i++) slug = `${base}-${i}`;
    usedSlugs.add(slug);
    return slug;
  }


  const now = new Date();
  let doneProjects = 0;
  for (const batch of chunks(projectRows, 200)) {
    const inserted = await db
      .insert(schema.projects)
      .values(
        batch.map(({ rows: _rows, ...p }) => ({ ...p, slug: uniqueSlug(p.name, p.host), updatedAt: now })),
      )
      .onConflictDoUpdate({
        target: schema.projects.host,
        // Keep curated/edited name, category and status; refresh stats and imported descriptions.
        set: {
          description: sql`case when ${schema.projects.source} like 'bazaar:%' then excluded.description else ${schema.projects.description} end`,
          networks: sql`excluded.networks`,
          endpointCount: sql`excluded.endpoint_count`,
          calls30d: sql`excluded.calls_30d`,
          payers30d: sql`excluded.payers_30d`,
          minPriceUsd: sql`excluded.min_price_usd`,
          tags: sql`case when cardinality(${schema.projects.tags}) = 0 then excluded.tags else ${schema.projects.tags} end`,
          updatedAt: now,
        },
      })
      .returning({ id: schema.projects.id, host: schema.projects.host });

    const idByHost = new Map(inserted.map((r) => [r.host!, r.id]));
    const endpointValues = batch.flatMap((p) =>
      p.rows.map(({ host, serviceName: _s, networks: _n, ...r }) => ({ ...r, projectId: idByHost.get(host)!, updatedAt: now })),
    );
    for (const epBatch of chunks(endpointValues, 400)) {
      await db
        .insert(schema.endpoints)
        .values(epBatch)
        .onConflictDoUpdate({
          target: [schema.endpoints.url, schema.endpoints.method],
          set: {
            projectId: sql`excluded.project_id`,
            description: sql`excluded.description`,
            network: sql`excluded.network`,
            asset: sql`excluded.asset`,
            amount: sql`excluded.amount`,
            priceUsd: sql`excluded.price_usd`,
            payTo: sql`excluded.pay_to`,
            scheme: sql`excluded.scheme`,
            facilitator: sql`excluded.facilitator`,
            x402Version: sql`excluded.x402_version`,
            tags: sql`excluded.tags`,
            bazaarInfo: sql`excluded.bazaar_info`,
            calls30d: sql`excluded.calls_30d`,
            payers30d: sql`excluded.payers_30d`,
            lastCalledAt: sql`excluded.last_called_at`,
            sourceUpdatedAt: sql`excluded.source_updated_at`,
            updatedAt: now,
          },
        });
    }
    doneProjects += batch.length;
  }
  log(`Wrote ${doneProjects} projects.`);
  summary.written = doneProjects;
  return summary;
}
