// Upserts the hand-checked ecosystem entries from src/data/curated.ts.
import "./env";
import { sql } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { curated } from "../src/data/curated";

const db = await getDb();
const now = new Date();
await db
  .insert(schema.projects)
  .values(
    curated.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description,
      website: p.website,
      github: p.github ?? null,
      docs: p.docs ?? null,
      host: p.host ?? null,
      networks: p.networks ?? [],
      tags: p.tags ?? [],
      featured: p.featured ?? false,
      status: "approved" as const,
      source: "curated",
      updatedAt: now,
    })),
  )
  .onConflictDoUpdate({
    target: schema.projects.slug,
    set: {
      name: sql`excluded.name`,
      category: sql`excluded.category`,
      description: sql`excluded.description`,
      website: sql`excluded.website`,
      github: sql`excluded.github`,
      docs: sql`excluded.docs`,
      networks: sql`excluded.networks`,
      tags: sql`excluded.tags`,
      featured: sql`excluded.featured`,
      updatedAt: now,
    },
  });
console.log(`Seeded ${curated.length} curated projects.`);
process.exit(0);
