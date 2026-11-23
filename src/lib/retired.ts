import { TOKEN } from "@/lib/constants";

// Retired official APIs, each with the API that answers the same. Their gateway is paused in /admin, and nothing of
// ours calls, shelves or suggests them even if one is turned back on: the agent, the Telegram bot, the Playground,
// Explore and /llms.txt skip them. /api/v1/gateways lists one only while it's listed and active.
// Token Price was Token Lookup with $AUTONOMO fixed.
export const RETIRED_GATEWAYS: Readonly<Record<string, { name: string; replacement: { name: string; path: string } }>> = {
  "token-price": { name: "Token Price", replacement: { name: "Token Lookup", path: `/x/token-lookup/price/${TOKEN.address}` } },
};

export const RETIRED_SLUGS: readonly string[] = Object.keys(RETIRED_GATEWAYS);

export const isRetired = (slug: string) => Object.hasOwn(RETIRED_GATEWAYS, slug);

/**
 * What a paused, retired gateway answers in place of "paused": 410 Gone with the API to call instead, so an agent that
 * calls it by name can move on without a person. Nothing is charged. Null for any other gateway.
 */
export function retiredAnswer(slug: string, origin: string): Response | null {
  if (!isRetired(slug)) return null;
  const { name, replacement } = RETIRED_GATEWAYS[slug];
  const url = `${origin.replace(/\/+$/, "")}${replacement.path}`;
  const res = Response.json(
    {
      error: "api_retired",
      message: `${name} is retired. ${replacement.name} answers the same, at the same price: call ${url}`,
      replacement: { name: replacement.name, url },
    },
    { status: 410 },
  );
  res.headers.set("Link", `<${url}>; rel="successor-version"`);
  return res;
}
