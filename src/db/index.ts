import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzleNeon<typeof schema>>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

async function connect(): Promise<DB> {
  if (process.env.DATABASE_URL) {
    return drizzleNeon(neon(process.env.DATABASE_URL), { schema });
  }
  // Local fallback: embedded Postgres (PGlite) persisted in ./.pglite.
  // Only one process can open it at a time, so stop `next dev` before running db scripts.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite("./.pglite");
  return drizzle(client, { schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  globalForDb.__db ??= connect();
  return globalForDb.__db;
}

export { schema };
