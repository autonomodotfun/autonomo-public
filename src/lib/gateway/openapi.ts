import { BAZAAR_LISTINGS } from "@/lib/gateway/bazaar";
import EXAMPLES from "@/lib/gateway/bazaar-examples.json";

// The OpenAPI document at /openapi.json: the official APIs described the way x402 catalogues read them.
// x402scan and AgentCash discover a seller only from {origin}/openapi.json (their spec: x402scan.com/discovery/spec).
// A paid operation needs x-payment-info (a fixed USD price and the x402 protocol), a 402 response, and an input
// schema, which for a GET is its parameters. They then call each route unpaid and expect the 402 price list, which
// stays the final word on price.
//
// Everything here comes from what the gateways already publish: the Bazaar listings (paths, inputs, descriptions),
// the stored example answers, and each gateway's live price. Kept free of server-only imports so it can be tested
// on its own; the route reads the gateways and calls buildOpenApi.

/** The public contact address, the one SECURITY.md already gives. */
export const OPENAPI_CONTACT = "contact@autonomo.fun";

/** A listed, active gateway, as far as this document needs it. */
export type OpenApiGateway = { slug: string; name: string; priceUsd: string | number };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = Record<string, unknown>;

const GUIDANCE_LIMIT = 4000;

/** A JSON Schema that fits one example answer: types only, nothing marked required, since it is a single sample. */
export function schemaOf(value: Json, depth = 0): Schema {
  if (value === null || depth > 6) return {};
  if (Array.isArray(value)) return { type: "array", items: value.length ? schemaOf(value[0], depth + 1) : {} };
  if (typeof value === "object") {
    return { type: "object", properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, schemaOf(v, depth + 1)])) };
  }
  return { type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string" };
}

const operationId = (slug: string) => slug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** "0.01" as the catalogues want it: decimal US dollars with six places. */
const usd = (price: string | number) => Number(price).toFixed(6);

function parameters(
  where: "path" | "query",
  schema: { properties: Record<string, unknown>; required?: string[] } | undefined,
  examples: Record<string, string> | undefined,
) {
  return Object.entries(schema?.properties ?? {}).map(([name, raw]) => {
    const { description, ...rest } = raw as { description?: string } & Schema;
    return {
      name,
      in: where,
      required: where === "path" || (schema?.required ?? []).includes(name),
      ...(description ? { description } : {}),
      schema: rest,
      ...(examples?.[name] !== undefined ? { example: examples[name] } : {}),
    };
  });
}

function guidance(origin: string) {
  return [
    "Autonomo's official APIs answer questions about tokens, wallets, transactions, payments and websites on Robinhood Chain (eip155:4663) and Base (eip155:8453).",
    "Every route is a GET with its inputs in the path or the query string, and each call has a fixed price.",
    "Call a route with no payment to get HTTP 402 with the price list in the PAYMENT-REQUIRED header. Pay one of the options with x402 (exact scheme) and send the same request again with the payment.",
    "The options are USDC on Base, and USDG or the AUTONOMO token on Robinhood Chain. No account and no API key.",
    "A call the API fails to answer is not charged.",
    "Routes that take a token, a wallet or a transaction read Robinhood Chain when chain is left out, and Base when the token, wallet or transaction is only there. chain=robinhood or chain=base reads that chain only.",
    "For a token someone is about to buy, /x/token-risk/risk/{token} is the usual first call.",
    `Every API with its price and a sample answer is in plain text at ${origin}/llms.txt.`,
  ].join(" ");
}

/**
 * The document for the gateways given. A gateway is described only when it has a Bazaar listing, so an API that is
 * not listed and active (the caller passes only those) never appears, and neither does one without an input schema.
 */
export function buildOpenApi(gateways: OpenApiGateway[], { origin, contactEmail = OPENAPI_CONTACT }: { origin: string; contactEmail?: string | null }) {
  const base = origin.replace(/\/+$/, "");
  const paths: Record<string, unknown> = {};
  for (const g of gateways) {
    const l = BAZAAR_LISTINGS[g.slug as keyof typeof BAZAAR_LISTINGS];
    if (!l) continue;
    const example = EXAMPLES[g.slug as keyof typeof EXAMPLES] as Json;
    const input = [...parameters("path", l.pathParamsSchema, l.pathParams), ...parameters("query", l.querySchema, l.query)];
    // A route with no declared input can't be called by a catalogue's agents, so it is left out rather than listed broken.
    if (input.length === 0) continue;
    paths[l.routeTemplate.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")] = {
      get: {
        operationId: operationId(g.slug),
        summary: g.name,
        description: l.description,
        tags: l.tags,
        "x-payment-info": {
          price: { mode: "fixed", currency: "USD", amount: usd(g.priceUsd) },
          protocols: [{ x402: {} }],
        },
        parameters: input,
        responses: {
          "200": {
            description: "The answer. The payment settles only when the API answers.",
            content: { "application/json": { schema: schemaOf(example), example } },
          },
          "402": { description: "Payment Required" },
        },
      },
    };
  }
  const text = guidance(base);
  return {
    openapi: "3.1.0",
    info: {
      title: "Autonomo official APIs",
      version: "1.0.0",
      description:
        "Pay-per-call APIs run by Autonomo: token lookups, launches, risk checks, holders, wallets, transactions, payments, gas, web pages and swaps on Robinhood Chain and Base. Paid with x402, per call, with no account.",
      "x-guidance": text.length > GUIDANCE_LIMIT ? text.slice(0, GUIDANCE_LIMIT) : text,
      contact: { name: "Autonomo", url: base, ...(contactEmail ? { email: contactEmail } : {}) },
    },
    servers: [{ url: base }],
    paths,
  };
}
