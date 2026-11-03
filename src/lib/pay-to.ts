import "server-only";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { TOKEN } from "@/lib/constants";
import { revalidateCatalog } from "@/lib/queries";

// Where an owner's gateways get paid. The first Safe is set by the owner with a signature from their sign-in wallet:
// that wallet already gets the money, so choosing a Safe gives it nothing new. Every change after that goes through
// /admin, since by then the Safe holds the earnings and the Verified tokens.

/**
 * Sets the wallet that all of an owner's gateways pay. Naming the owner itself clears it. One statement, so it all
 * applies or none. `kind` is logged in wallet_switches. Returns the slugs it moved, empty if the owner has none.
 */
export async function applyPayTo(owner: string, payTo: string, kind: "pay_to" | "pay_to_signed" = "pay_to") {
  const db = await getDb();
  const result = await db.execute<{ slugs: string[] }>(sql`
    with moved as (
      update gateways set pay_to = nullif(${payTo}::text, owner), updated_at = now() where owner = ${owner} returning slug, project_id
    ), listed as (
      update endpoints set pay_to = ${payTo}
      where facilitator = 'autonomo' and project_id in (select project_id from moved)
        and lower(pay_to) in (select coalesce(pay_to, owner) from gateways where owner = ${owner})
    ), logged as (
      insert into wallet_switches (from_owner, to_owner, slugs, kind)
      select ${owner}::text, ${payTo}::text, array_agg(slug), ${kind}::text from moved having count(*) > 0
      returning slugs
    )
    select slugs from logged`);
  const rows = "rows" in result ? result.rows : (result as unknown as { slugs: string[] }[]);
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidateCatalog();
  return rows[0]?.slugs ?? [];
}

/** What the sign-in wallet signs to set its first Safe. Free, and not a transaction. */
export function firstSafeMessage(owner: string, safe: string, issuedAt: Date) {
  return [
    "Autonomo: pay my APIs to this Safe",
    "",
    `Sign-in wallet: ${owner}`,
    `Safe: ${safe}`,
    `Network: ${TOKEN.chainName} (${TOKEN.chainId})`,
    `Issued: ${issuedAt.toISOString()}`,
    "",
    "Signing is free and doesn't send a transaction. Once it's set, changing where your APIs get paid needs Autonomo to approve it.",
  ].join("\n");
}
