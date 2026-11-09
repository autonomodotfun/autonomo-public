import { z } from "zod";

// The official APIs as typed tools for the AI agent. The model only fills in validated inputs: our code builds the
// URL, so it can never choose a host, a payee or a price.

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

type ToolSpec<S extends z.ZodObject> = {
  slug: string;
  description: string;
  input: S;
  path: (input: z.infer<S>) => string;
};

const spec = <S extends z.ZodObject>(s: ToolSpec<S>) => s as unknown as ToolSpec<z.ZodObject>;

export const AGENT_TOOLS: Record<string, ToolSpec<z.ZodObject>> = {
  token_price: spec({
    slug: "token-price",
    description: "Current USD and ETH price of $AUTONOMO, from its last on-chain trade. For any other token use token_lookup.",
    input: z.strictObject({}),
    path: () => "/price/autonomo",
  }),
  token_lookup: spec({
    slug: "token-lookup",
    description: "Current price of any Robinhood Chain token, by contract address.",
    input: z.strictObject({ address: address.describe("Token contract address") }),
    path: ({ address }) => `/price/${address.toLowerCase()}`,
  }),
  token_risk: spec({
    slug: "token-risk",
    description: "Rug-risk score of a token, with its holder concentration, creator, launch-block buyers and bot volume.",
    input: z.strictObject({ address: address.describe("Token contract address") }),
    path: ({ address }) => `/risk/${address.toLowerCase()}`,
  }),
  new_launches: spec({
    slug: "new-launches",
    description: "The newest Robinhood Chain launchpad tokens, with age, buys, sells, market cap and curve progress.",
    input: z.strictObject({ limit: z.number().int().min(1).max(25).describe("How many launches to return") }),
    path: ({ limit }) => `/launches?limit=${limit}`,
  }),
  tx_explainer: spec({
    slug: "tx-explainer",
    description: "A Robinhood Chain transaction in plain English: launches, curve buys and sells, transfers and fee.",
    input: z.strictObject({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Transaction hash") }),
    path: ({ hash }) => `/tx/${hash.toLowerCase()}`,
  }),
  wallet_portfolio: spec({
    slug: "wallet-portfolio",
    description: "What a wallet holds on Robinhood Chain, valued in USD. Copies of known symbols are flagged as likely impostors.",
    input: z.strictObject({ address: address.describe("Wallet address") }),
    path: ({ address }) => `/portfolio/${address.toLowerCase()}`,
  }),
  page_reader: spec({
    slug: "page-reader",
    description: "Title, description and readable text of a public web page.",
    input: z.strictObject({ url: z.url({ protocol: /^https$/ }).max(2000).describe("An https:// link") }),
    path: ({ url }) => `/page?url=${encodeURIComponent(url)}`,
  }),
  ostrapad_offers: spec({
    slug: "ostrapad-offer-finder",
    description:
      "Find AI agents for hire on Ostrapad, the Robinhood Chain market where agents are paid in USDG through escrow and judged before payout. Returns matching offers with price, delivery time, who judges the work, each provider's record and a link to its Ostrapad page. An Autonomo API built on Ostrapad's public listings, not an official Ostra API.",
    input: z.strictObject({
      need: z.string().min(2).max(200).describe("What the work is, in a few words, e.g. 'protocol risk report'"),
      max_price: z.number().positive().max(500).optional().describe("Most USDG per job"),
    }),
    path: ({ need, max_price }) => `/offers?q=${encodeURIComponent(need)}${max_price ? `&max_price=${max_price}` : ""}`,
  }),
};

// Web pages can say anything, so what they contain may not lead to more spending.
// Listings on Ostrapad are written by their agents, so they can say anything too.
export const UNTRUSTED_TEXT_TOOLS = new Set(["page_reader", "ostrapad_offers"]);

/** Tool definitions for the model, for the APIs that are live right now. */
export function toolDefinitions(liveSlugs: Set<string>) {
  return Object.entries(AGENT_TOOLS)
    .filter(([, t]) => liveSlugs.has(t.slug))
    .map(([name, t]) => {
      const { $schema: _, ...schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
      return {
        name,
        description: t.description,
        input_schema: { ...schema, type: "object" as const },
        // Inputs stream unvalidated, so runAiAgent checks each one against `input` before using it.
        eager_input_streaming: true,
      };
    });
}
