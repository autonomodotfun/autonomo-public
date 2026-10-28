// Deletes a project (and its endpoints) by slug, plus any submission with the same name.
// Usage: npm run db:remove -- <slug>
import "./env";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";

const slug = process.argv[2];
if (!slug) throw new Error("Usage: npm run db:remove -- <slug>");
const db = await getDb();
const [removed] = await db
  .delete(schema.projects)
  .where(eq(schema.projects.slug, slug))
  .returning({ name: schema.projects.name });
if (removed) await db.delete(schema.submissions).where(eq(schema.submissions.name, removed.name));
console.log(removed ? `Removed ${removed.name}.` : `No project with slug ${slug}.`);
process.exit(0);
