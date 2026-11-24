import { json, options, withUpdating } from "@/lib/api";
import { GATEWAY_USAGE } from "@/lib/agent/playground";
import { getGatewayBonds, getTrackRecords, getVerifiedGateways, listAutonomoGateways } from "@/lib/directory/queries";
import { AUTONOMO_DISCOUNT } from "@/lib/gateway/gateway-rules";
import { offersBase } from "@/lib/gateway/gateway";

export { options as OPTIONS };

// Every listed, active Autonomo gateway, with prices and the path to call. Used by the Autonomo MCP server.
export const GET = withUpdating(async () => {
  const [rows, { slugs }, bonds, records] = await Promise.all([
    listAutonomoGateways(),
    getVerifiedGateways(),
    getGatewayBonds(),
    getTrackRecords().catch((e) => (console.error("track records failed", e), null)),
  ]);
  return json({
    data: rows.map((g) => ({
      slug: g.slug,
      name: g.name,
      description: g.description,
      url: `https://autonomo.fun/x/${g.slug}`,
      usage: GATEWAY_USAGE[g.slug] ?? "/",
      price: {
        autonomo: g.autonomoAmount === null ? null : Number(g.autonomoAmount),
        usdg: g.acceptUsdg ? Number(g.priceUsd) : null,
        // USDC on Base, same dollar price. The 402 lists it while Coinbase's facilitator is answering.
        usdcBase: offersBase(g) ? Number(g.priceUsd) : null,
      },
      // The $AUTONOMO amount follows the dollar price, this much lower, at the previous day's average. Set daily.
      autonomoPricing: g.autonomoAmount === null ? null : { followsUsd: Number(g.priceUsd), discount: AUTONOMO_DISCOUNT },
      project: `https://autonomo.fun/projects/${g.projectSlug}`,
      verified: slugs.includes(g.slug),
      // The wallet this API pays has locked the provider bond's minimum and wasn't slashed in the last 30 days (/bond).
      bonded: bonds.slugs.includes(g.slug),
      trackRecord: trackRecordOf(records?.[g.slug]),
    })),
  });
});

// The public shape: counts from the last windowDays days of paid calls (see src/lib/directory/track-record.ts). null when the
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
