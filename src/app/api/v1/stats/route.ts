import { json, options, withUpdating } from "@/lib/api";
import { getStats } from "@/lib/directory/queries";

export { options as OPTIONS };

export const GET = withUpdating(async () => {
  return json({ data: await getStats() });
});
