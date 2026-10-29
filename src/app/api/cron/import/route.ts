import { timingSafeEqual } from "node:crypto";
import { importBazaar } from "@/lib/bazaar-import";

// Daily directory refresh (scheduled in vercel.json): re-imports the Coinbase CDP and PayAI discovery catalogs so
// project counts, prices and 30-day call numbers stay current. Vercel calls it with `Authorization: Bearer
// $CRON_SECRET`; anyone else gets 401.

// Fetching ~100k listings and writing them takes a few minutes.
export const maxDuration = 800;

function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  const lines: string[] = [];
  try {
    const summary = await importBazaar({ log: (l) => lines.push(l) });
    console.log("directory import", { ...summary, seconds: Math.round((Date.now() - started) / 1000) });
    return Response.json({ ok: true, ...summary, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    console.error("directory import failed", e, lines.slice(-20));
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), log: lines.slice(-20) }, { status: 500 });
  }
}
