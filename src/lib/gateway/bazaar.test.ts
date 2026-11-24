// Offline checks of the Bazaar listings against the rules the x402 package and Coinbase's docs set.
// Run: npx tsx --conditions=react-server --test src/lib/gateway/bazaar.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidIconUrl, isValidRouteTemplate, isValidServiceName, sanitizeTags, validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { BAZAAR_ICON, BAZAAR_LISTINGS, BAZAAR_SERVICE, bazaarExtension, bazaarRouteFields } from "@/lib/gateway/bazaar";
import EXAMPLES from "@/lib/gateway/bazaar-examples.json";

const OFFICIAL = [
  "token-lookup", "new-launches", "token-risk", "tx-explainer", "wallet-portfolio", "dev-wallet",
  "holders-bundles", "payment-check", "gas-now", "endpoint-health", "website-check", "page-reader",
  "ostrapad-offer-finder", "tokyo-futuro-job-finder", "safe-swap",
];

test("all 15 official APIs have a listing and a real example answer", () => {
  assert.deepEqual(Object.keys(BAZAAR_LISTINGS).sort(), [...OFFICIAL].sort());
  assert.deepEqual(Object.keys(EXAMPLES).sort(), [...OFFICIAL].sort());
});

test("the retired Token Price has no listing, so its gateway sends the Bazaar nothing", () => {
  assert.equal(bazaarExtension("token-price"), null);
  assert.deepEqual(bazaarRouteFields("token-price"), {});
});

test("service name, icon and tags pass the Bazaar's checks", () => {
  assert.ok(isValidServiceName(BAZAAR_SERVICE));
  assert.ok(isValidIconUrl(BAZAAR_ICON));
  assert.ok(BAZAAR_ICON.endsWith(".png"), "SVG is refused");
  for (const [slug, l] of Object.entries(BAZAAR_LISTINGS)) assert.deepEqual(sanitizeTags(l.tags), l.tags, slug);
});

for (const [slug, l] of Object.entries(BAZAAR_LISTINGS)) {
  test(`${slug}: valid listing`, () => {
    assert.ok(l.description.length <= 500, `${l.description.length} characters`);
    assert.ok(l.description.length >= 60, "says what it does, not just a name");
    assert.doesNotMatch(l.description, /\b(you must|always|ignore|call this|send|pay)\b/i, "describes, doesn't instruct");
    assert.ok(isValidRouteTemplate(l.routeTemplate), l.routeTemplate);
    assert.ok(l.routeTemplate.startsWith(`/x/${slug}/`), "the gateway's own path");
    for (const name of Object.keys(l.pathParams ?? {})) assert.ok(l.routeTemplate.includes(`:${name}`), `:${name} in the template`);

    const ext = bazaarExtension(slug)!.bazaar;
    // The server fills in the method per request; a listing must be valid once it has.
    const enriched = {
      ...ext,
      info: { ...ext.info, input: { ...ext.info.input, method: "GET" } },
      schema: {
        ...ext.schema,
        properties: {
          ...ext.schema.properties,
          input: { ...ext.schema.properties.input, properties: { ...ext.schema.properties.input.properties, method: { type: "string", enum: ["GET"] } } },
        },
      },
    };
    const result = validateDiscoveryExtension(enriched as never);
    assert.ok(result.valid, result.errors?.join("; ") ?? "invalid");
    assert.equal((ext as { routeTemplate?: string }).routeTemplate, l.routeTemplate);
  });
}

test("the example answers hold no Playground wallet", () => {
  assert.ok(!JSON.stringify(EXAMPLES).toLowerCase().includes("0xde87838695ba7151ae93ca24c96b2f5334f4988b"));
});

test("an API without a listing adds nothing to its 402", () => {
  assert.deepEqual(bazaarRouteFields("someone-elses-api"), {});
});

test("a 402 for an official API carries the listing", async () => {
  const { generatePrivateKey } = await import("viem/accounts");
  process.env.FACILITATOR_PRIVATE_KEY = generatePrivateKey();
  delete process.env.CDP_API_KEY_ID;
  const { acceptsFor, offers, x402Server } = await import("@/lib/payments/payments");
  const { withX402 } = await import("@x402/next");
  const { NextRequest, NextResponse } = await import("next/server");
  const handler = withX402(
    async () => NextResponse.json({ ok: true }),
    {
      accepts: acceptsFor("0xc66181e50aF128ffEe6048E8d4097bDC84776313", offers({ priceUsd: "0.01", acceptUsdg: true, autonomoAmount: "59" })),
      description: "fallback",
      mimeType: "application/json",
      ...bazaarRouteFields("token-risk"),
    },
    x402Server()!,
  );
  const res = await handler(new NextRequest(`https://autonomo.fun/x/token-risk/risk/${"0x" + "ab".repeat(20)}`));
  assert.equal(res.status, 402);
  const required = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"));
  assert.equal(required.resource.description, BAZAAR_LISTINGS["token-risk"].description);
  assert.equal(required.resource.serviceName, "Autonomo");
  const bazaar = required.extensions.bazaar;
  assert.equal(bazaar.routeTemplate, "/x/token-risk/risk/:token");
  assert.equal(bazaar.info.input.method, "GET", "filled in from the request");
  assert.ok(bazaar.info.output.example.risk, "real example answer");
});
