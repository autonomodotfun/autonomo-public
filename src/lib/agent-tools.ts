import { z } from "zod";

// The official APIs as typed tools for the AI agent. The model only fills in validated inputs: our code builds the
// URL, so it can never choose a host, a payee or a price.

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

type ToolSpec<S extends z.ZodObject> = {
  slug: string;
  description: string;
  input: S;
  path: (input: z.infer<S>) => string;
  /** Shortens a long answer before the model reads it, keeping what an answer needs (results are cut at 8,000 characters). */
  forModel?: (data: unknown) => unknown;
};

const HOLDERS_SHOWN = 10;
const GROUPS_SHOWN = 5;
const SNIPERS_SHOWN = 5;
const SAME_BLOCKS_SHOWN = 3;

/**
 * Holders & Bundles lists 30 holders, every linked group and up to 40 snipers, so a full answer runs past the cut and
 * would lose its end. The model gets the flags and summary whole, the largest holders, groups and snipers, and counts
 * for the rest.
 */
function holdersForModel(data: unknown) {
  if (!data || typeof data !== "object" || !Array.isArray((data as { topHolders?: unknown }).topHolders)) return data;
  const d = data as Record<string, unknown> & { topHolders: unknown[] };
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const snipers = (d.snipers ?? {}) as Record<string, unknown>;
  const groups = list(d.linkedGroups);
  const sameBlock = list(d.sameBlockBuyers);
  const buyers = list(snipers.buyers);
  return {
    token: d.token,
    creator: d.creator,
    flags: d.flags,
    summary: d.summary,
    topHolders: d.topHolders.slice(0, HOLDERS_SHOWN),
    topHoldersNotShown: Math.max(0, d.topHolders.length - HOLDERS_SHOWN),
    linkedGroups: groups.slice(0, GROUPS_SHOWN),
    linkedGroupsNotShown: Math.max(0, groups.length - GROUPS_SHOWN),
    snipers: { ...snipers, buyers: buyers.slice(0, SNIPERS_SHOWN), buyersNotShown: Math.max(0, buyers.length - SNIPERS_SHOWN) },
    sameBlockBuyers: sameBlock.slice(0, SAME_BLOCKS_SHOWN),
    sameBlockBuyersNotShown: Math.max(0, sameBlock.length - SAME_BLOCKS_SHOWN),
    repeatSnipersChecked: d.repeatSnipersChecked,
    explorer: d.explorer,
    note: d.note,
  };
}

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
  dev_wallet: spec({
    slug: "dev-wallet",
    description:
      "What a token's creator did: tokens bought, burned, locked, sold and still held, creator fees claimed and waiting, where their ETH went, who funded the wallet and other tokens they launched.",
    input: z.strictObject({ address: address.describe("Token contract address") }),
    path: ({ address }) => `/dev/${address.toLowerCase()}`,
  }),
  holders_bundles: spec({
    slug: "holders-bundles",
    description:
      "Who really holds a token: top holders with pool and burns set apart, wallets linked by a shared funder, snipers in the first 15 seconds and what they still hold, same-block buyers and repeat snipers.",
    input: z.strictObject({ address: address.describe("Token contract address") }),
    path: ({ address }) => `/holders/${address.toLowerCase()}`,
    forModel: holdersForModel,
  }),
  payment_check: spec({
    slug: "payment-check",
    description:
      "Did an x402 payment settle on Robinhood Chain? Who paid whom, how much in USDG or $AUTONOMO, and who paid the gas. Pass to, amount or asset for a yes or no match on a receipt.",
    input: z.strictObject({
      hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("Transaction hash"),
      to: address.optional().describe("The wallet that should have been paid"),
      amount: z.string().regex(/^\d+(\.\d{1,18})?$/).optional().describe("The amount that should have been paid, such as 0.01"),
      asset: z.enum(["usdg", "autonomo"]).optional().describe("The token the amount is in; USDG when left out"),
    }),
    path: ({ hash, to, amount, asset }) => {
      const params = new URLSearchParams();
      if (to) params.set("to", to.toLowerCase());
      if (amount) params.set("amount", amount);
      if (asset) params.set("asset", asset);
      const query = params.toString();
      return `/payment/${hash.toLowerCase()}${query ? `?${query}` : ""}`;
    },
  }),
  gas_now: spec({
    slug: "gas-now",
    description: "The current gas price on Robinhood Chain and what it costs in ETH and USD to send ETH, send USDG, buy on a launchpad curve or launch a token.",
    input: z.strictObject({}),
    path: () => "/gas",
  }),
  endpoint_health: spec({
    slug: "endpoint-health",
    description: "Is an x402 API up and payable right now? One unpaid call reports the answer time and whether its 402 payment request is complete.",
    input: z.strictObject({
      url: z.url({ protocol: /^https$/ }).max(2000).describe("The paid address, an https:// link"),
      method: z.enum(["GET", "POST"]).optional().describe("GET when left out"),
    }),
    path: ({ url, method }) => `/endpoint?url=${encodeURIComponent(url)}${method === "POST" ? "&method=POST" : ""}`,
  }),
  website_check: spec({
    slug: "website-check",
    description:
      "A trust check for a website or domain: domain age and registrar, certificate, where it redirects and whether the name imitates a well-known one, with a caution level.",
    input: z.strictObject({ site: z.string().min(4).max(2000).describe("An https:// link or a bare domain, such as example.com") }),
    path: ({ site }) => `/site?url=${encodeURIComponent(site)}`,
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
// The two checks report what an outside server or website says about itself (a page title, a payment request).
export const UNTRUSTED_TEXT_TOOLS = new Set(["page_reader", "ostrapad_offers", "endpoint_health", "website_check"]);

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
