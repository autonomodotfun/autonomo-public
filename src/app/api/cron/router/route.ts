import { timingSafeEqual } from "node:crypto";
import { routerEnabled, runRouterJobs } from "@/lib/router/router-gateway";

// The router's regular work (src/lib/router/router-gateway.ts): uptime probes every 15 minutes, a probe of each routable API
// once a day (three a day while it is new or off its record), and a tidy-up. Scheduled every 5 minutes in vercel.json,
// which needs a Vercel plan that allows more than one run a day. Each API is only probed when its own time has come,
// so most runs find nothing to do; every 5 minutes, not 15, so an uptime probe is never held back a whole extra round
// by being a few seconds early. While the router is off, a run does nothing. Vercel calls it with
// `Authorization: Bearer $CRON_SECRET`; anyone else gets 401.

export const maxDuration = 60;

function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new Response("unauthorized", { status: 401 });
  if (!routerEnabled()) return Response.json({ ok: true, skipped: "ROUTER_ENABLED is not set" });
  try {
    const run = await runRouterJobs();
    console.log("router jobs", JSON.stringify(run));
    return Response.json({ ok: true, ...run });
  } catch (e) {
    console.error("router jobs failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
