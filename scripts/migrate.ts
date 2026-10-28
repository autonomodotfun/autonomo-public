import "./env";
import { getDb } from "../src/db";

const db = await getDb();
if (process.env.DATABASE_URL) {
  const { migrate } = await import("drizzle-orm/neon-http/migrator");
  await migrate(db, { migrationsFolder: "drizzle" });
} else {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db as never, { migrationsFolder: "drizzle" });
}
console.log("Migrations applied.");
process.exit(0);
