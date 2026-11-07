import { json, options, withUpdating } from "@/lib/api";
import { GATEWAY_USAGE } from "@/lib/playground";
import { getTrackRecords, getVerifiedGateways, listAutonomoGateways } from "@/lib/queries";

export { options as OPTIONS };

// Every listed, active Autonomo gateway, with prices and the path to call. Used by the Autonomo MCP server.
export const GET = withUpdating(async () => {
  const [rows, { slugs }, records] = await Promise.all([
    listAutonomoGateways(),
    getVerifiedGateways(),
    getTrackRecords().catch((e) => (console.error("track records failed", e), null)),
  ]);
  return json({
    data: rows.map((g) => ({
      slug: g.slug,
      name: g.name,
      description: g.description,
      url: `https://autonomo.fun/x/${g.slug}`,
      usage: GATEWAY_USAGE[g.slug] ?? "/",
      price: { autonomo: g.autonomoAmount === null ? null : Number(g.autonomoAmount), usdg: g.acceptUsdg ? Number(g.priceUsd) : null },
      project: `https://autonomo.fun/projects/${g.projectSlug}`,
      verified: slugs.includes(g.slug),
      trackRecord: trackRecordOf(records?.[g.slug]),
    })),
  });
});

// The public shape: counts from the last windowDays days of paid calls (see src/lib/track-record.ts). null when the
// numbers can't be read right now.
function trackRecordOf(r: Awaited<ReturnType<typeof getTrackRecords>>[string] | undefined) {
  if (!r) return null;
  return {
    windowDays: r.windowDays,
    new: r.isNew,
    outsidePayers: r.outsidePayers,
    repeatPayers: r.repeatPayers,
    privateCalls: r.privateCalls,
    paidCalls: r.paidCalls,
    settledCalls: r.settledCalls,
    refusedCalls: r.refusedCalls,
    failedCalls: r.failedCalls,
    successRate: r.successRate,
    medianMs: r.medianMs,
    liveSince: r.liveSince,
  };
}
