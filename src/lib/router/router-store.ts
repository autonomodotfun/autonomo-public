import { and, desc, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { schema, type DB } from "@/db";
import type { MeasuredCall, Route, RouterStore, Stats } from "@/lib/router/router";

// The router's record in the database (tables router_* in src/db/schema.ts). The rules are in router.ts; this file
// only saves rows and reads them back, and is held to the same tests as the in-memory store (router-store.test.ts).
//
// The site talks to the database one statement at a time, with no transactions, so anything that must not happen
// twice is a single statement: using a route id is one UPDATE that only matches while the id is unused.

const { routerCalls, routerUptime, routerSlashes, routerBlockedPayers, routerRoutes, routerHits, routerStats } = schema;

const DAY_SECONDS = 86_400;
const count = sql<number>`count(*)::int`;

export function routerStore(db: DB): RouterStore {
  // An API's saved stats are cleared after its record changed, as a second statement. A request that works the stats
  // out between the two can save a copy that misses the change; it is replaced within 15 minutes, and sooner by the
  // regular job, which refreshes every copy.
  const forget = (slug: string) => db.delete(routerStats).where(eq(routerStats.slug, slug));

  return {
    async saveStats(api, stats, at) {
      const row = {
        payTo: api.payTo.toLowerCase(),
        measured: stats.measured,
        valid: stats.valid,
        medianMs: stats.medianMs,
        uptime: stats.uptime,
        lastSlash: stats.lastSlash === null ? null : new Date(stats.lastSlash),
        at: new Date(at),
      };
      await db
        .insert(routerStats)
        .values({ slug: api.slug, ...row })
        .onConflictDoUpdate({ target: routerStats.slug, set: row, setWhere: lte(routerStats.at, row.at) });
    },

    async savedStats(slugs, since) {
      if (!slugs.length) return new Map();
      const rows = await db
        .select()
        .from(routerStats)
        .where(and(inArray(routerStats.slug, slugs), gte(routerStats.at, new Date(since))));
      return new Map(
        rows.map((r): [string, Stats] => [
          r.slug,
          { measured: r.measured, valid: r.valid, answerRate: r.measured ? r.valid / r.measured : 0, medianMs: r.medianMs, uptime: r.uptime, lastSlash: r.lastSlash?.getTime() ?? null },
        ]),
      );
    },

    async recordCall(call) {
      await db.insert(routerCalls).values({
        slug: call.slug,
        at: new Date(call.at),
        valid: call.valid,
        ms: call.ms === null ? null : Math.round(call.ms),
        kind: call.kind,
        payer: call.payer.toLowerCase(),
        settled: call.settled,
        reason: call.reason.slice(0, 300),
        counted: call.counted,
      });
      if (call.counted) await forget(call.slug);
    },

    async countedCalls(slug, since, limit, maxFailsPerPayerDay) {
      // Each payer's failed routed calls are numbered through their UTC day, oldest first; other calls get 1. Keeping
      // numbers up to the cap leaves out what one wallet sent past it, however the calls arrived.
      const failed = sql`(${routerCalls.kind} = 'routed' and not ${routerCalls.valid})`;
      const nth = sql<number>`case when ${failed} then row_number() over (
          partition by ${routerCalls.payer}, floor(extract(epoch from ${routerCalls.at}) / ${DAY_SECONDS}), ${failed}
          order by ${routerCalls.at}, ${routerCalls.id}
        ) else 1 end`.as("nth");
      const numbered = db
        .select({
          id: routerCalls.id,
          slug: routerCalls.slug,
          at: routerCalls.at,
          valid: routerCalls.valid,
          ms: routerCalls.ms,
          kind: routerCalls.kind,
          payer: routerCalls.payer,
          settled: routerCalls.settled,
          reason: routerCalls.reason,
          counted: routerCalls.counted,
          nth,
        })
        .from(routerCalls)
        .where(and(eq(routerCalls.slug, slug), routerCalls.counted, gte(routerCalls.at, new Date(since))))
        .as("numbered");
      const rows = await db
        .select()
        .from(numbered)
        .where(lte(numbered.nth, maxFailsPerPayerDay))
        .orderBy(desc(numbered.at), desc(numbered.id))
        .limit(limit);
      return rows.map(
        (r): MeasuredCall => ({ slug: r.slug, at: r.at.getTime(), valid: r.valid, ms: r.ms, kind: r.kind, payer: r.payer, settled: r.settled, reason: r.reason, counted: r.counted }),
      );
    },

    async probesSince(slug, since) {
      const [row] = await db
        .select({ n: count })
        .from(routerCalls)
        .where(and(eq(routerCalls.slug, slug), eq(routerCalls.kind, "probe"), gte(routerCalls.at, new Date(since))));
      return row?.n ?? 0;
    },

    async lastProbe(slug) {
      const [r] = await db
        .select()
        .from(routerCalls)
        .where(and(eq(routerCalls.slug, slug), eq(routerCalls.kind, "probe")))
        .orderBy(desc(routerCalls.at), desc(routerCalls.id))
        .limit(1);
      if (!r) return null;
      return { slug: r.slug, at: r.at.getTime(), valid: r.valid, ms: r.ms, kind: r.kind, payer: r.payer, settled: r.settled, reason: r.reason, counted: r.counted };
    },

    async recordUptime(slug, up, at) {
      await db.insert(routerUptime).values({ slug, up, at: new Date(at) });
      await forget(slug);
    },

    async uptime(slug, since) {
      const [row] = await db
        .select({ total: count, up: sql<number>`count(*) filter (where ${routerUptime.up})::int` })
        .from(routerUptime)
        .where(and(eq(routerUptime.slug, slug), gte(routerUptime.at, new Date(since))));
      return { up: row?.up ?? 0, total: row?.total ?? 0 };
    },

    async lastUptime(slug) {
      const [row] = await db.select({ at: routerUptime.at }).from(routerUptime).where(eq(routerUptime.slug, slug)).orderBy(desc(routerUptime.at)).limit(1);
      return row ? row.at.getTime() : null;
    },

    async recordSlash(slug, payTo, at) {
      const wallet = payTo.toLowerCase();
      await db.insert(routerSlashes).values({ slug, payTo: wallet, at: new Date(at) });
      // A slash covers every API of the wallet.
      await db.delete(routerStats).where(or(eq(routerStats.slug, slug), eq(routerStats.payTo, wallet)));
    },

    async lastSlash(slug, payTo) {
      const [row] = await db
        .select({ at: routerSlashes.at })
        .from(routerSlashes)
        .where(or(eq(routerSlashes.slug, slug), eq(routerSlashes.payTo, payTo.toLowerCase())))
        .orderBy(desc(routerSlashes.at))
        .limit(1);
      return row ? row.at.getTime() : null;
    },

    async blockPayer(payer, until) {
      const row = { payer: payer.toLowerCase(), until: new Date(until) };
      await db.insert(routerBlockedPayers).values(row).onConflictDoUpdate({ target: routerBlockedPayers.payer, set: { until: row.until } });
    },

    async blockedUntil(payer) {
      const [row] = await db.select({ until: routerBlockedPayers.until }).from(routerBlockedPayers).where(eq(routerBlockedPayers.payer, payer.toLowerCase())).limit(1);
      return row ? row.until.getTime() : null;
    },

    async saveRoute(route) {
      await db.insert(routerRoutes).values({
        id: route.id,
        capability: route.capability,
        inputs: route.inputs,
        slug: route.slug,
        tried: route.tried,
        expires: new Date(route.expires),
      });
    },

    async openRoutes(capability, inputs, now) {
      // jsonb compares by content, so the order the inputs were given in doesn't matter.
      const rows = await db
        .select()
        .from(routerRoutes)
        .where(
          and(
            eq(routerRoutes.capability, capability),
            eq(routerRoutes.used, false),
            gt(routerRoutes.expires, new Date(now)),
            sql`${routerRoutes.inputs} = ${JSON.stringify(inputs)}::jsonb`,
          ),
        )
        .orderBy(desc(routerRoutes.expires))
        .limit(20);
      return rows.map((row) => ({ id: row.id, capability: row.capability, inputs: row.inputs, slug: row.slug, tried: row.tried, expires: row.expires.getTime() }));
    },

    async takeRoute(id, now) {
      const [row] = await db
        .update(routerRoutes)
        .set({ used: true })
        .where(and(eq(routerRoutes.id, id), eq(routerRoutes.used, false), gt(routerRoutes.expires, new Date(now))))
        .returning();
      if (!row) return null;
      return { id: row.id, capability: row.capability, inputs: row.inputs, slug: row.slug, tried: row.tried, expires: row.expires.getTime() } satisfies Route;
    },

    async countHit(key, minute) {
      const [row] = await db
        .insert(routerHits)
        .values({ key, minute: new Date(minute) })
        .onConflictDoUpdate({ target: [routerHits.key, routerHits.minute], set: { n: sql`${routerHits.n} + 1` } })
        .returning({ n: routerHits.n });
      return row.n;
    },
  };
}

const DAY_MS = DAY_SECONDS * 1000;

/**
 * Clears out what the router no longer reads: uptime probes older than 30 days, route ids that expired more than a
 * day ago, pauses that are over, rate-limit counts older than an hour, and saved stats nothing has refreshed for a
 * day (an API that is gone). Measured calls are kept, since a slash is decided from them.
 */
export async function pruneRouterRecord(db: DB, now: number) {
  await db.delete(routerStats).where(lt(routerStats.at, new Date(now - DAY_MS)));
  await db.delete(routerUptime).where(lt(routerUptime.at, new Date(now - 30 * DAY_MS)));
  await db.delete(routerRoutes).where(lt(routerRoutes.expires, new Date(now - DAY_MS)));
  await db.delete(routerBlockedPayers).where(lt(routerBlockedPayers.until, new Date(now)));
  await db.delete(routerHits).where(lt(routerHits.minute, new Date(now - 3_600_000)));
}
