// What a paused, retired gateway answers. Run: npx tsx --conditions=react-server --test src/lib/retired.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { isRetired, retiredAnswer, RETIRED_SLUGS } from "@/lib/retired";

const LOOKUP = "https://autonomo.fun/x/token-lookup/price/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";

test("Token Price is the one retired API", () => {
  assert.deepEqual(RETIRED_SLUGS, ["token-price"]);
  assert.ok(isRetired("token-price"));
  assert.ok(!isRetired("token-lookup"));
  assert.ok(!isRetired("constructor"), "only its own keys, nothing from Object's prototype");
});

test("paused Token Price answers 410 with Token Lookup's address for $AUTONOMO", async () => {
  const res = retiredAnswer("token-price", "https://autonomo.fun/")!;
  assert.equal(res.status, 410);
  assert.equal(res.headers.get("link"), `<${LOOKUP}>; rel="successor-version"`);
  const body = await res.json();
  assert.equal(body.error, "api_retired");
  assert.deepEqual(body.replacement, { name: "Token Lookup", url: LOOKUP });
  assert.match(body.message, /^Token Price is retired\. Token Lookup answers the same, at the same price: call https:\/\/autonomo\.fun\/x\/token-lookup\//);
});

test("any other paused API keeps the plain paused answer", () => {
  assert.equal(retiredAnswer("token-lookup", "https://autonomo.fun"), null);
});
