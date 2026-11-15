import "server-only";
import { eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logAdmin } from "@/lib/admin-log";
import { planReprice } from "@/lib/gateway-rules";
import { dayPriceUsd } from "@/lib/pool-price";
import { revalidateCatalog } from "@/lib/queries";

const { gateways } = schema;

/**
 * Works out every API's $AUTONOMO price again at today's token price (the previous UTC day's average), official and
 * creator APIs alike. Run daily by /api/cron/reprice, just after the day's average is known.
 */
export async function repriceAll() {
  const tokenUsd = await dayPriceUsd();
  const db = await getDb();
  const rows = await db
    .select({ id: gateways.id, priceUsd: gateways.priceUsd, autonomoAmount: gateways.autonomoAmount })
    .from(gateways)
    .where(isNotNull(gateways.autonomoAmount));
  // numeric columns come back as "0.010000"; the plan compares the price as the form saves it.
  const changes = planReprice(
    rows.map((r) => ({ ...r, priceUsd: String(Number(r.priceUsd)) })),
    tokenUsd,
  );
  for (const c of changes) {
    await db.update(gateways).set({ priceUsd: c.priceUsd, autonomoAmount: c.autonomoAmount }).where(eq(gateways.id, c.id));
  }
  if (changes.length) {
    revalidateCatalog();
    await logAdmin({
      kind: "prices_updated",
      subject: `${changes.length} API${changes.length === 1 ? "" : "s"}`,
      detail: `At $${tokenUsd.toPrecision(3)} per $AUTONOMO (the previous day's average)`,
    });
  }
  return { tokenUsd, checked: rows.length, changed: changes.length };
}
