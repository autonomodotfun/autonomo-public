import { json, options, withUpdating } from "@/lib/api";
import { rewardsEnabled, walletRewards } from "@/lib/rewards/rewards";

export { options as OPTIONS };

// One wallet's standing for the monthly rewards: what it holds against the two minimums, its ref code, and its
// counted calls this month. Everything in it is public already (balances and payments are on chain), so it needs no
// sign-in. It gives counts, never amounts: what a month pays is worked out at the end of that month.
export const GET = withUpdating(async (request: Request) => {
  if (!rewardsEnabled()) return json({ error: "not_found" }, { status: 404 });
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  const found = await walletRewards(address);
  if (!found) return json({ error: "bad_request", message: "Pass a wallet address: ?address=0x…" }, { status: 400 });
  return json(found);
});
