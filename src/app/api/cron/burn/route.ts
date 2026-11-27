import { timingSafeEqual } from "node:crypto";
import { alertTeam } from "@/lib/alerts";
import { burnEnabled, runBurnKeeper } from "@/lib/payments/burn";

// Daily backup for the burn (scheduled in vercel.json): a payment flushes its payee's splitter at a threshold, and this
// catches anyone below it. It flushes each payee's burn splitter, which burns 5% of $AUTONOMO and sends
// 5% of USDG to the buyback contract, sends 5% of Base payments from the mirror burn pot to it (once MIRROR_BURN_POT is
// set), then buys back and burns with that USDG. Last, it checks what a person would have to act on (the mirror
// stopped, the pot's float above its cap, a shared burn address frozen or blacklisted) and sends those to the team chat.
// Vercel calls it with
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
    const alerted = run.alerts.length ? await alertTeam("Autonomo burn check", run.alerts) : false;
    const ok = run.errors.length === 0 && run.alerts.length === 0;
    return Response.json({ ok, ...run, alerted }, { status: ok ? 200 : 500 });
  } catch (e) {
    console.error("burn keeper failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
