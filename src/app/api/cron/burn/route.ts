import { timingSafeEqual } from "node:crypto";
import { burnEnabled, runBurnKeeper } from "@/lib/burn";

// Daily backup for the burn (scheduled in vercel.json): a payment flushes its payee's splitter at a threshold, and this
// catches anyone below it. It flushes each payee's burn splitter, which burns 5% of $AUTONOMO and sends
// 5% of USDG to the buyback contract, then buys back and burns with that USDG. Vercel calls it with
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
  if (!burnEnabled()) return Response.json({ ok: true, skipped: "BURN_SPLITTER_FACTORY is not set" });
  try {
    const run = await runBurnKeeper();
    console.log("burn keeper", run);
    return Response.json({ ok: run.errors.length === 0, ...run }, { status: run.errors.length ? 500 : 200 });
  } catch (e) {
    console.error("burn keeper failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
