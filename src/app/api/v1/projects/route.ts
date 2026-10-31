import type { NextRequest } from "next/server";
import { json, options, withUpdating } from "@/lib/api";
import { parseProjectQuery, searchProjects } from "@/lib/queries";

export { options as OPTIONS };

export const GET = withUpdating(async (request: NextRequest) => {
  const query = parseProjectQuery(Object.fromEntries(request.nextUrl.searchParams));
  const { rows, total, page, limit, sort } = await searchProjects(query);
  return json({
    data: rows.map(({ id: _id, ...p }) => ({
      ...p,
      minPriceUsd: p.minPriceUsd === null ? null : Number(p.minPriceUsd),
      url: `/projects/${p.slug}`,
    })),
    meta: { total, page, limit, sort, pages: Math.ceil(total / limit) },
  });
});
