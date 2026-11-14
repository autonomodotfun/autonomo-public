import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";

// The record of what was decided from /admin. Writing to it never stops the decision itself: if the table isn't
// there yet (the database update hasn't been run on this deployment), the action still goes through and the History
// tab says so.

const { adminEvents } = schema;

export const ADMIN_EVENT_LABELS = {
  listing_approved: "API listed",
  listing_rejected: "API listing rejected",
  submission_approved: "Directory submission approved",
  submission_rejected: "Directory submission rejected",
  api_paused: "API paused",
  api_resumed: "API resumed",
  project_hidden: "Hidden from the directory",
  project_shown: "Shown in the directory",
  project_featured: "Featured",
  project_unfeatured: "No longer featured",
  pay_to_set: "Payout wallet set",
  pay_to_request_approved: "Payout request approved",
  pay_to_request_rejected: "Payout request rejected",
  wallet_switched: "Creator wallet switched",
} as const;
export type AdminEventKind = keyof typeof ADMIN_EVENT_LABELS;
export type AdminEvent = typeof adminEvents.$inferSelect;

export async function logAdmin(event: { kind: AdminEventKind; subject: string; detail?: string | null; note?: string | null; gatewayId?: number | null }) {
  try {
    const db = await getDb();
    await db.insert(adminEvents).values({
      kind: event.kind,
      subject: event.subject.slice(0, 200),
      detail: event.detail?.slice(0, 500) || null,
      note: event.note?.slice(0, 300) || null,
      gatewayId: event.gatewayId ?? null,
    });
  } catch (e) {
    console.error("admin event not recorded", event.kind, e instanceof Error ? e.message : e);
  }
}

/** The newest events, optionally of some kinds only. Null when the history table isn't there yet. */
export async function recentAdminEvents(limit: number, kinds?: AdminEventKind[]): Promise<AdminEvent[] | null> {
  try {
    const db = await getDb();
    const query = db.select().from(adminEvents);
    return await (kinds?.length ? query.where(inArray(adminEvents.kind, kinds)) : query).orderBy(desc(adminEvents.createdAt)).limit(limit);
  } catch {
    return null;
  }
}

/** The reason given the last time this API's listing was rejected, for its creator's dashboard. */
export async function lastRejectionNote(gatewayId: number): Promise<string | null> {
  try {
    const db = await getDb();
    const [row] = await db
      .select({ note: adminEvents.note })
      .from(adminEvents)
      .where(and(eq(adminEvents.gatewayId, gatewayId), eq(adminEvents.kind, "listing_rejected")))
      .orderBy(desc(adminEvents.createdAt))
      .limit(1);
    return row?.note ?? null;
  } catch {
    return null;
  }
}
