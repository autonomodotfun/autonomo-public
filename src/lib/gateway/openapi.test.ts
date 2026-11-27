// Offline checks of /openapi.json against the rules x402scan's discovery spec sets (x402scan.com/discovery/spec).
// Run: npx tsx --conditions=react-server --test src/lib/gateway/openapi.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { BAZAAR_LISTINGS } from "@/lib/gateway/bazaar";
import { buildOpenApi, OPENAPI_CONTACT, schemaOf } from "@/lib/gateway/openapi";

const ORIGIN = "https://autonomo.fun";
const LISTED = Object.keys(BAZAAR_LISTINGS).filter((slug) => slug !== "ostrapad-offer-finder");
const gateways = LISTED.map((slug) => ({ slug, name: `Name of ${slug}`, priceUsd: slug === "gas-now" ? "0.005000" : "0.01" }));

type Operation = {
  operationId: string;
  summary: string;
  description: string;
  "x-payment-info": { price: { mode: string; currency: string; amount: string }; protocols: unknown[] };
  parameters: { name: string; in: string; required: boolean; schema: Record<string, unknown>; example?: string; description?: string }[];
  responses: Record<string, { description: string; content?: { "application/json": { schema: { type?: string }; example: unknown } } }>;
};
const doc = buildOpenApi(gateways, { origin: ORIGIN });
const operations = Object.entries(doc.paths as Record<string, { get: Operation }>);

test("the document has the top-level fields a catalogue requires", () => {
  assert.match(doc.openapi, /^3\.1\./);
  assert.ok(doc.info.title && doc.info.version && doc.info.description);
  const guidance = doc.info["x-guidance"];
  assert.ok(guidance.length > 200 && guidance.length <= 4000, `guidance is ${guidance.length} characters`);
  assert.equal(doc.info.contact.email, OPENAPI_CONTACT);
  assert.deepEqual(doc.servers, [{ url: ORIGIN }]);
});

test("every listed official API is one GET route, and nothing else is in it", () => {
  assert.equal(operations.length, LISTED.length);
  for (const slug of LISTED) {
    const path = operations.find(([p]) => p.startsWith(`/x/${slug}/`));
    assert.ok(path, `${slug} is missing`);
    assert.deepEqual(Object.keys(path[1]), ["get"], `${slug} should only answer GET`);
  }
});

test("an API that isn't passed in, or has no listing, is left out", () => {
  // The caller passes only listed, active gateways, so an API taken off the site never appears here.
  assert.ok(!operations.some(([p]) => p.includes("ostrapad")));
  const withOutsider = buildOpenApi([...gateways, { slug: "someone-elses-api", name: "Outside", priceUsd: "0.02" }], { origin: ORIGIN });
  assert.equal(Object.keys(withOutsider.paths).length, LISTED.length);
  assert.deepEqual(buildOpenApi([], { origin: ORIGIN }).paths, {});
});

test("each paid route has a fixed USD price, the x402 protocol and a 402 response", () => {
  for (const [path, { get }] of operations) {
    const info = get["x-payment-info"];
    assert.deepEqual(info.protocols, [{ x402: {} }], path);
    assert.equal(info.price.mode, "fixed", path);
    assert.equal(info.price.currency, "USD", path);
    assert.match(info.price.amount, /^\d+\.\d{6}$/, `${path}: decimal dollars, not token units`);
    assert.deepEqual(get.responses["402"], { description: "Payment Required" }, path);
  }
  const gas = operations.find(([p]) => p.startsWith("/x/gas-now/"))![1].get;
  assert.equal(gas["x-payment-info"].price.amount, "0.005000");
  const risk = operations.find(([p]) => p.startsWith("/x/token-risk/"))![1].get;
  assert.equal(risk["x-payment-info"].price.amount, "0.010000");
});

test("each route declares its inputs: path parameters match the path, and required ones carry an example", () => {
  for (const [path, { get }] of operations) {
    assert.ok(!path.includes(":"), `${path} still has an Express-style parameter`);
    assert.ok(get.parameters.length > 0, `${path} has no input schema, so a catalogue would skip it`);
    const inPath = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
    const declared = get.parameters.filter((p) => p.in === "path");
    assert.deepEqual(declared.map((p) => p.name).sort(), inPath, path);
    for (const p of get.parameters) {
      assert.ok(p.in === "path" || p.in === "query", `${path} ${p.name}`);
      assert.ok(p.schema && typeof p.schema === "object" && !("description" in p.schema), `${path} ${p.name}: the description belongs on the parameter`);
      if (p.in === "path") assert.equal(p.required, true, `${path} ${p.name}`);
      // A probe fills the path from the examples to reach the 402.
      if (p.required) assert.ok(typeof p.example === "string" && p.example.length > 0, `${path} ${p.name} needs an example`);
    }
  }
});

test("each route has an output schema and the real example answer", () => {
  for (const [path, { get }] of operations) {
    const body = get.responses["200"].content?.["application/json"];
    assert.ok(body, path);
    assert.equal(body.schema.type, "object", path);
    assert.ok(body.example && typeof body.example === "object", path);
  }
});

test("operation ids are unique and the whole document is plain JSON", () => {
  const ids = operations.map(([, { get }]) => get.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z][A-Za-z0-9]+$/);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
});

test("schemaOf describes a sample without marking anything required", () => {
  assert.deepEqual(schemaOf({ a: 1, b: "x", c: true, d: null, e: [{ f: 1.5 }], g: [] }), {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "string" },
      c: { type: "boolean" },
      d: {},
      e: { type: "array", items: { type: "object", properties: { f: { type: "number" } } } },
      g: { type: "array", items: {} },
    },
  });
});

test("the contact address can be left out", () => {
  assert.equal("email" in buildOpenApi(gateways, { origin: ORIGIN, contactEmail: null }).info.contact, false);
});
