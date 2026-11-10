import "server-only";
import { unstable_cache } from "next/cache";
import { connection } from "next/server";

// Pages built from cached reads are rendered once and served to every visitor from the cache, then rebuilt in the
// background when their data's cache time runs out or its tag is cleared (see cachedRead in queries.ts). A page
// refreshes as often as its shortest-lived read: 5 minutes with gateway lists, an hour with track records, a day
// with directory data.

/**
 * Wait for a request before reading the database, but only on the embedded local database.
 *
 * With DATABASE_URL set (production and previews), reads may run while a page is built, so the page can be cached.
 * Without it the database is PGlite, which only one process can open at a time: a build's parallel workers can't
 * share it, so there every read waits for a request, and pages render per visit as they always did.
 */
export async function untilLocalDbIsFree() {
  if (!process.env.DATABASE_URL) await connection();
}

const soon = unstable_cache(async () => null, ["retry-soon"], { revalidate: 60 });

/**
 * Call when a read failed and the page shows a fallback. A cached page would otherwise keep that fallback for as
 * long as the failed read's cache time, up to a day; this makes the page rebuild after a minute instead.
 */
export async function retrySoon() {
  await soon();
}
