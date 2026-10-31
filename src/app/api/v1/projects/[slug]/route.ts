import { json, options, withUpdating } from "@/lib/api";
import { getProject } from "@/lib/queries";

export { options as OPTIONS };

export const GET = withUpdating(async (_request: Request, ctx: RouteContext<"/api/v1/projects/[slug]">) => {
  const data = await getProject((await ctx.params).slug);
  if (!data) return json({ error: "not_found" }, { status: 404 });
  const { id: _id, search: _search, status: _status, ...project } = data.project;
  return json({
    data: {
      ...project,
      minPriceUsd: project.minPriceUsd === null ? null : Number(project.minPriceUsd),
      endpoints: data.endpoints.map(({ id: _eid, ...e }) => ({
        ...e,
        priceUsd: e.priceUsd === null ? null : Number(e.priceUsd),
      })),
    },
  });
});
