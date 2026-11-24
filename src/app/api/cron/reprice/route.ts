import { timingSafeEqual } from "node:crypto";
import { repriceAll } from "@/lib/payments/reprice";

// Daily $AUTONOMO repricing (scheduled in vercel.json, just after midnight UTC): every API's $AUTONOMO price follows its
// dollar price, 20% lower, at the previous day's average token price. Vercel calls it with
// `Authorization: Bearer $CRON_SECRET`; anyone else gets 401.

export const maxDuration = 300;

function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new Response("unauthorized", { status: 401 });
  try {
    const run = await repriceAll();
    console.log("reprice", run);
    return Response.json({ ok: true, ...run });
  } catch (e) {
    // Nothing changed: every API keeps yesterday's amount until the price can be read.
    console.error("reprice failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
