import { json, options, withUpdating } from "@/lib/api";
import { GATEWAY_USAGE } from "@/lib/playground";
import { listAutonomoGateways } from "@/lib/queries";

export { options as OPTIONS };

// Every listed, active Autonomo gateway, with prices and the path to call. Used by the Autonomo MCP server.
export const GET = withUpdating(async () => {
  const rows = await listAutonomoGateways();
  return json({
    data: rows.map((g) => ({
      slug: g.slug,
      name: g.name,
      description: g.description,
      url: `https://autonomo.fun/x/${g.slug}`,
      usage: GATEWAY_USAGE[g.slug] ?? "/",
      price: { autonomo: g.autonomoAmount === null ? null : Number(g.autonomoAmount), usdg: g.acceptUsdg ? Number(g.priceUsd) : null },
      project: `https://autonomo.fun/projects/${g.projectSlug}`,
    })),
  });
});
