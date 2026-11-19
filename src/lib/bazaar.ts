import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import EXAMPLES from "./bazaar-examples.json";

// What Coinbase's x402 Bazaar lists for each official API: a description, how to call it and a real example answer.
// Coinbase indexes an API after its first payment settled through Coinbase's facilitator (USDC on Base), and drops it
// after 30 days without one. Rules from its docs: a description that says what the API does in 500 characters or
// fewer, complete input schemas with realistic examples, and nothing that reads as an instruction to an agent.
//
// The examples in bazaar-examples.json are real answers from each API, with lists cut to two items and the
// Playground wallet replaced by a placeholder address.

export const BAZAAR_SERVICE = "Autonomo";
export const BAZAAR_ICON = "https://autonomo.fun/apple-icon.png";

const AUTONOMO = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96";
const ADDRESS = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const TX_HASH = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" };
const HTTPS_URL = { type: "string", pattern: "^https://[^\\s]+$" };

type Listing = {
  /** The paid path with its parameters, as the Bazaar lists it. */
  routeTemplate: string;
  description: string;
  tags: string[];
  pathParams?: Record<string, string>;
  pathParamsSchema?: { properties: Record<string, unknown>; required: string[] };
  query?: Record<string, string>;
  querySchema?: { properties: Record<string, unknown>; required?: string[] };
};

const token = (what: string, where = "on Robinhood Chain") => ({
  pathParams: { token: AUTONOMO },
  pathParamsSchema: { properties: { token: { ...ADDRESS, description: `${what} token's contract address ${where}` } }, required: ["token"] },
});

/** The optional chain input of APIs that also read Base. */
const chainInput = (fallback: string) => ({
  type: "string",
  enum: ["robinhood", "base"],
  description: `Optional. Left out, Robinhood Chain, or Base when ${fallback}; robinhood or base reads that chain only`,
});

// APIs that also read Base: left out, the chain is Robinhood Chain, or Base when the token is only there.
const bothChains = {
  ...token("The", "on Robinhood Chain or Base"),
  query: {},
  querySchema: { properties: { chain: chainInput("the token is only there") } },
};

export const BAZAAR_LISTINGS: Record<keyof typeof EXAMPLES, Listing> = {
  "token-price": {
    routeTemplate: "/x/token-price/price/autonomo",
    description:
      "The live price of $AUTONOMO, the Autonomo launchpad token on Robinhood Chain, in USD and ETH, with its market cap and the latest trade. Read from the token's Uniswap v4 pool; ETH/USD from Chainlink.",
    tags: ["price", "token", "robinhood-chain", "autonomo"],
  },
  "token-lookup": {
    routeTemplate: "/x/token-lookup/price/:token",
    description:
      "Price and market cap of a token in USD and ETH: a Robinhood Chain launchpad token from its bonding curve or Uniswap v4 pool, with the latest trade, or a Base token from its deepest pool, with what that pool holds in ETH or USDC and its 24 hour trades.",
    tags: ["price", "token", "market-cap", "base", "robinhood-chain"],
    ...bothChains,
  },
  "new-launches": {
    routeTemplate: "/x/new-launches/launches",
    description:
      "The newest token launches: on the Robinhood Chain launchpad with buys, sells, unique buyers, market cap and bonding curve progress, or on Base's Clanker and Zora with price, market cap, main pool and 24 hour trades. Name, age and creator for each.",
    tags: ["launches", "new-tokens", "memecoins", "base", "robinhood-chain"],
    query: { limit: "3" },
    querySchema: {
      properties: {
        limit: { type: "string", pattern: "^[0-9]{1,2}$", description: "How many launches, 1 to 25; 10 when left out" },
        chain: { type: "string", enum: ["robinhood", "base"], description: "Optional: robinhood (the default) or base" },
      },
    },
  },
  "token-risk": {
    routeTemplate: "/x/token-risk/risk/:token",
    description:
      "A rug-risk score for a token on Robinhood Chain or Base, from holder concentration, the creator's share, launch-block buyers, trading patterns and, on Base, how much ETH or USDC its main pool holds, with each flag explained. Useful before buying a new token. A heuristic from public data, not financial advice.",
    tags: ["risk", "rug-check", "token-safety", "base", "robinhood-chain"],
    ...bothChains,
  },
  "tx-explainer": {
    routeTemplate: "/x/tx-explainer/tx/:hash",
    description:
      "A Robinhood Chain or Base transaction in plain English: launches and where the supply went, buys, sells and swaps, who sent what to whom, the fee in ETH and USD, and the contracts involved.",
    tags: ["transaction", "explainer", "base", "robinhood-chain"],
    pathParams: { hash: "0x3572d00c16b869fbeec6d267e08108b2d5decdb93d90532114f66390d6099f65" },
    pathParamsSchema: { properties: { hash: { ...TX_HASH, description: "The transaction hash on Robinhood Chain or Base" } }, required: ["hash"] },
    query: {},
    querySchema: { properties: { chain: chainInput("the transaction is only there") } },
  },
  "wallet-portfolio": {
    routeTemplate: "/x/wallet-portfolio/portfolio/:wallet",
    description:
      "Everything a wallet holds on Robinhood Chain or Base: ETH, stablecoins and every other token, each valued in USD, with a total. Impostor tokens, such as fake USDG or USDC airdrops, are flagged.",
    tags: ["wallet", "portfolio", "balances", "base", "robinhood-chain"],
    pathParams: { wallet: "0x92a99fbd386f87277b6009bff4c56728ec5f7354" },
    pathParamsSchema: { properties: { wallet: { ...ADDRESS, description: "The wallet address" } }, required: ["wallet"] },
    query: {},
    querySchema: { properties: { chain: chainInput("the wallet holds nothing on Robinhood Chain") } },
  },
  "dev-wallet": {
    routeTemplate: "/x/dev-wallet/dev/:token",
    description:
      "What a token's creator did with it, on Robinhood Chain or Base: tokens bought, burned, locked, sold and still held, where their ETH went, who funded the wallet and other tokens they launched. On Base the creator is found from Clanker and Zora launches. Creator fees on Robinhood Chain's launchpad.",
    tags: ["dev-wallet", "creator", "token-safety", "base", "robinhood-chain"],
    ...bothChains,
  },
  "holders-bundles": {
    routeTemplate: "/x/holders-bundles/holders/:token",
    description:
      "Who really holds a token on Robinhood Chain or Base: top holders with the pool, launch contracts and burns set apart, wallets linked by a shared funder, snipers in the first 15 seconds and what they still hold, and same-block buyers. Reads new Base launches straight from the chain.",
    tags: ["holders", "bundles", "snipers", "base", "robinhood-chain"],
    ...bothChains,
  },
  "payment-check": {
    routeTemplate: "/x/payment-check/payment/:hash",
    description:
      "Whether an x402 payment settled, on Robinhood Chain (USDG or $AUTONOMO) or Base (USDC): who paid whom, how much, how it was paid and who paid the gas. With to, amount or asset it also says whether the payment matches a receipt.",
    tags: ["x402", "payment", "receipt", "base", "robinhood-chain"],
    pathParams: { hash: "0xfd8a1c8c76410ec259ae171fe21a4438657ae579642c4ec2cd38966565dc574e" },
    pathParamsSchema: { properties: { hash: { ...TX_HASH, description: "The payment's transaction hash on Robinhood Chain or Base" } }, required: ["hash"] },
    query: {},
    querySchema: {
      properties: {
        to: { ...ADDRESS, description: "Optional: the wallet that should have been paid" },
        amount: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", description: "Optional: the amount that should have been paid" },
        asset: { type: "string", enum: ["usdg", "autonomo", "usdc"], description: "Optional: the token it should have been paid in: usdg or autonomo on Robinhood Chain, usdc on Base" },
        chain: chainInput("the transaction is only there"),
      },
    },
  },
  "gas-now": {
    routeTemplate: "/x/gas-now/gas",
    description:
      "The current gas price on Robinhood Chain or Base and what common actions cost right now in ETH and USD, measured from recent transactions: sending ETH and a stablecoin, a trade and a token launch. Base fees include its L1 fee.",
    tags: ["gas", "fees", "base", "robinhood-chain"],
    query: {},
    querySchema: { properties: { chain: { type: "string", enum: ["robinhood", "base"], description: "Optional: robinhood (the default) or base" } } },
  },
  "endpoint-health": {
    routeTemplate: "/x/endpoint-health/endpoint",
    description:
      "Whether an x402 API is up and payable right now. One unpaid call to the given address reports how fast it answered and whether its payment request is complete: scheme, network, asset, amount and payee, with any problems listed.",
    tags: ["x402", "health-check", "uptime", "monitoring"],
    query: { url: "https://autonomo.fun/x/gas-now/gas" },
    querySchema: { properties: { url: { ...HTTPS_URL, description: "The x402 API address to check" } }, required: ["url"] },
  },
  "website-check": {
    routeTemplate: "/x/website-check/site",
    description:
      "A trust check for a website or domain: how old the domain is and its registrar, the certificate, where the site redirects and whether the name imitates a well-known one, summed up as a caution level.",
    tags: ["website", "domain", "phishing", "trust"],
    query: { url: "autonomo.fun" },
    querySchema: { properties: { url: { type: "string", minLength: 3, description: "A link or a bare domain" } }, required: ["url"] },
  },
  "page-reader": {
    routeTemplate: "/x/page-reader/page",
    description: "The title, description and readable text of a public web page, without the menus, scripts and markup.",
    tags: ["web", "scraping", "text", "reader"],
    query: { url: "https://example.com" },
    querySchema: { properties: { url: { ...HTTPS_URL, description: "The page address" } }, required: ["url"] },
  },
  "ostrapad-offer-finder": {
    routeTemplate: "/x/ostrapad-offer-finder/offers",
    description:
      "AI agents for hire on Ostrapad, the market on Robinhood Chain where agents are hired for work in USDG through escrow: the offers that match the work described, each with its price, delivery time, how the work is judged and the agent's record read from Ostrapad's contract, linked to the agent's Ostrapad page. Built on Ostrapad's public listings.",
    tags: ["agents", "hire", "marketplace", "ostrapad", "robinhood-chain"],
    query: { q: "risk report" },
    querySchema: {
      properties: {
        q: { type: "string", maxLength: 200, description: "The work wanted, in a few words" },
        max_price: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", description: "Optional: the highest price in USDG" },
        limit: { type: "string", pattern: "^[0-9]{1,2}$", description: "How many offers, 1 to 20; 5 when left out" },
      },
    },
  },
  "tokyo-futuro-job-finder": {
    routeTemplate: "/x/tokyo-futuro-job-finder/jobs",
    description:
      "Open paid jobs an AI agent can take on Tokyo Futuro, the job market for agents on Robinhood Chain: the jobs that match the work described, each with its reward and bond in $ZENI as escrowed on chain, its deadline, how long ago it was posted, who posted it and whether a new wallet can take it. Built with Tokyo Futuro, read live from its list of open jobs.",
    tags: ["jobs", "agents", "bounties", "tokyo-futuro", "robinhood-chain"],
    query: { q: "cost sheet" },
    querySchema: {
      properties: {
        q: { type: "string", maxLength: 200, description: "The work wanted, in a few words" },
        min_reward: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", description: "Optional: the lowest reward in $ZENI" },
        max_reward: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", description: "Optional: the highest reward in $ZENI" },
        sort: { type: "string", enum: ["new", "reward"], description: "Optional: new (the default) or reward" },
        limit: { type: "string", pattern: "^[0-9]{1,2}$", description: "How many jobs, 1 to 20; 5 when left out" },
      },
    },
  },
  // Safe Swap is two paid calls, a quote and then a build of that quote. The Bazaar lists one address per API, so it
  // lists the quote, where every swap starts; payments for builds keep the same listing current.
  "safe-swap": {
    routeTemplate: "/x/safe-swap/swap/quote",
    description:
      "A checked swap quote on Robinhood Chain. Before an agent buys a token it checks the holders, the creator's wallet and the rug risk, finds KyberSwap's best route and quotes the way back to see that the token can be sold and at what loss, then answers ok, caution or block with a quote id. Building that quote returns unsigned transactions checked against it. Selling is never blocked.",
    tags: ["swap", "dex", "token-safety", "kyberswap", "robinhood-chain"],
    query: {
      token_in: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      token_out: AUTONOMO,
      amount_in: "1000000",
      taker: "0x92a99fbd386f87277b6009bff4c56728ec5f7354",
    },
    querySchema: {
      properties: {
        token_in: { type: "string", pattern: "^(0x[0-9a-fA-F]{40}|ETH)$", description: "The token sold: its address on Robinhood Chain, or ETH" },
        token_out: { type: "string", pattern: "^(0x[0-9a-fA-F]{40}|ETH)$", description: "The token bought: its address on Robinhood Chain, or ETH" },
        amount_in: { type: "string", pattern: "^[1-9][0-9]{0,77}$", description: "The amount sold in base units (1 USDG = 1000000)" },
        taker: { ...ADDRESS, description: "The wallet that signs the swap and receives what it buys" },
        slippage_bps: { type: "string", pattern: "^[0-9]{1,5}$", description: "Optional: the slippage allowed in basis points, 100 (1%) when left out, at most 500" },
      },
      required: ["token_in", "token_out", "amount_in", "taker"],
    },
  },
};

/** The Bazaar extension for an official API, or null when it has no listing. */
export function bazaarExtension(slug: string) {
  const l = BAZAAR_LISTINGS[slug as keyof typeof BAZAAR_LISTINGS];
  if (!l) return null;
  const ext = declareDiscoveryExtension({
    ...(l.query ? { input: l.query, inputSchema: { type: "object", ...l.querySchema } } : {}),
    ...(l.pathParams ? { pathParams: l.pathParams, pathParamsSchema: { type: "object", ...l.pathParamsSchema } } : {}),
    output: { example: EXAMPLES[slug as keyof typeof EXAMPLES] },
  });
  // The gateway is one catch-all route, so the template is set here: the Bazaar then lists one address per API,
  // not one per token or transaction someone looked up.
  return { bazaar: { ...ext.bazaar, routeTemplate: l.routeTemplate } };
}

/** The route config fields the Bazaar reads, for an official API. */
export function bazaarRouteFields(slug: string) {
  const l = BAZAAR_LISTINGS[slug as keyof typeof BAZAAR_LISTINGS];
  const extensions = bazaarExtension(slug);
  if (!l || !extensions) return {};
  return { description: l.description, serviceName: BAZAAR_SERVICE, tags: l.tags, iconUrl: BAZAAR_ICON, extensions };
}
