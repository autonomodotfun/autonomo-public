import { json, options } from "@/lib/api";
import { getStats } from "@/lib/queries";

export { options as OPTIONS };

export async function GET() {
  return json({ data: await getStats() });
}
