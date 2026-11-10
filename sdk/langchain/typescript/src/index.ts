// LangChain.js tools for Autonomo: let an agent find a paid API on Autonomo, see its price and pay for a call.
//
//   import { AutonomoToolkit } from "langchain-autonomo";
//   const tools = new AutonomoToolkit({ privateKey: process.env.AUTONOMO_WALLET_KEY }).getTools();
//
// The payments are made by the Autonomo SDK (autonomo-sdk on npm), with its per-call and daily caps. On top of those,
// the toolkit stops after maxCalls paid calls, so a looping agent can't keep paying.

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { Autonomo, AutonomoError, type Api, type AutonomoOptions } from "autonomo-sdk";
import { z } from "zod";

export const VERSION = "0.1.0";

const DEFAULT_MAX_CALLS = 10;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const FIND_LIMIT = 15;

export type AutonomoToolkitOptions = AutonomoOptions & {
  /** An Autonomo client you set up yourself, for example with Gloam or Borro. Instead of the SDK options. */
  client?: Autonomo;
  /** Paid calls through this toolkit, then it stops. Default 10; null for no limit; 0 gives only the free tools. */
  maxCalls?: number | null;
  /** Longer answers are cut before they reach the model. Default 20,000 characters. */
  maxOutputChars?: number;
};

const apiInfo = (a: Api) => ({
  slug: a.slug,
  name: a.name,
  description: a.description,
  path: a.path,
  price: a.price,
  verified: a.verified,
  successRate30d: a.successRate,
  paidCalls30d: a.paidCalls30d,
});

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n[cut: the answer was ${text.length} characters, the first ${limit} are shown]`;

/** What the model sees when a tool can't do what it asked: the reason, so it can choose another way. */
const refusal = (e: unknown) => {
  if (e instanceof AutonomoError) return JSON.stringify({ error: e.code, message: e.message });
  throw e;
};

const FIND_SCHEMA = z.object({
  query: z.string().default("").describe('What you need, in a few words, e.g. "is this token safe" or "wallet holdings". Empty lists every API.'),
  input: z
    .string()
    .optional()
    .describe("The value you'll pass, if any: a token or wallet address, a transaction hash or a link. Only APIs that take it are shown."),
});

const PRICE_FIELDS = {
  slug: z.string().optional().describe("The API's slug from autonomo_find_apis, e.g. token-risk."),
  path: z
    .string()
    .optional()
    .describe("The API's path with every <placeholder> filled in, e.g. /risk/0x86b5...ec49. Leave empty to use the API's example path filled with input."),
  query: z.string().default("").describe("Used only without a slug: what you need, to pick the best API."),
  input: z.string().optional().describe("The address, transaction hash, link or text to put in the path's <placeholder>."),
};
const PRICE_SCHEMA = z.object(PRICE_FIELDS);
const CALL_SCHEMA = z.object({
  ...PRICE_FIELDS,
  private: z.boolean().default(false).describe("Pay privately through Gloam. Only works when Gloam is set up; never falls back to a public payment."),
});

/** Autonomo's tools for a LangChain.js or LangGraph.js agent. */
export class AutonomoToolkit {
  readonly client: Autonomo;
  readonly maxCalls: number | null;
  readonly maxOutputChars: number;
  private readonly canPayWith: boolean;
  private paid = 0;

  /**
   * Pass a wallet key (a new wallet just for the agent) to let it pay, or a `client` you set up yourself. Without
   * either, only the free tools are given: finding APIs and their prices.
   */
  constructor(opts: AutonomoToolkitOptions = {}) {
    const { client, maxCalls = DEFAULT_MAX_CALLS, maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS, ...sdk } = opts;
    if (client && Object.values(sdk).some((v) => v !== undefined)) throw new Error("Pass either an Autonomo client or the options to make one, not both.");
    if (maxCalls !== null && !(Number.isInteger(maxCalls) && maxCalls >= 0)) throw new Error("maxCalls should be 0 or more, or null for no limit.");
    this.client = client ?? new Autonomo(sdk);
    this.maxCalls = maxCalls;
    this.maxOutputChars = maxOutputChars;
    // Gloam is set on the client; a private call can pay without a wallet key.
    const gloam = client ? (client as unknown as { gloam?: unknown }).gloam : sdk.gloam;
    this.canPayWith = Boolean(this.client.address || gloam);
  }

  /** True when getTools() gives the paying tool: a wallet key or Gloam is set, and maxCalls isn't 0. */
  get canPay(): boolean {
    return this.canPayWith && this.maxCalls !== 0;
  }

  /** Paid calls made through this toolkit's tools so far. */
  get paidCalls(): number {
    return this.paid;
  }

  getTools(): StructuredToolInterface[] {
    const client = this.client;

    const find = tool(
      async ({ query, input }) => {
        try {
          const apis = await client.find(query ?? "", input);
          if (!apis.length) return JSON.stringify({ apis: [], note: "No API matches. Try other words, or an empty query to list them all." });
          return JSON.stringify({ apis: apis.slice(0, FIND_LIMIT).map(apiInfo) });
        } catch (e) {
          return refusal(e);
        }
      },
      {
        name: "autonomo_find_apis",
        description:
          "Search Autonomo's paid APIs: crypto data on Robinhood Chain (token risk and prices, wallets, transactions, new launches) " +
          "and more, such as reading web pages. Free. Returns the best matches with each API's slug, what it does, its path " +
          "(with <placeholders> to fill), its price in USDG and $AUTONOMO, and its track record. Prefer verified APIs.",
        schema: FIND_SCHEMA,
      },
    );

    const price = tool(
      async ({ slug, path, query, input }) => {
        try {
          const q = await client.quote(query ?? "", { slug, path, input });
          return JSON.stringify({ api: { slug: q.api.slug, name: q.api.name }, url: q.url, offers: q.offers });
        } catch (e) {
          return refusal(e);
        }
      },
      {
        name: "autonomo_get_price",
        description:
          "See what one call to an Autonomo API costs, without paying: the exact URL and every way to pay it. Free. " +
          "Give the slug and path from autonomo_find_apis, or a query and input to pick the API.",
        schema: PRICE_SCHEMA,
      },
    );

    const tools: StructuredToolInterface[] = [find, price];
    if (!this.canPay) return tools;

    const call = tool(
      async ({ slug, path, query, input, private: priv }) => {
        // Reserve the call first, so calls running at the same time can't pass maxCalls together.
        if (this.maxCalls !== null && this.paid >= this.maxCalls) {
          return JSON.stringify({
            error: "over_limit",
            message: `This agent already made ${this.paid} paid calls, its limit (maxCalls). Don't call again; answer with what you have.`,
          });
        }
        this.paid++;
        try {
          const { data, receipt } = await client.call(query ?? "", { slug, path, input, private: priv });
          const text = typeof data === "string" ? data : JSON.stringify(data);
          // A long answer is cut to fit the model's context; the payment was for the whole answer either way.
          return JSON.stringify({ receipt, data: text.length > this.maxOutputChars ? clip(text, this.maxOutputChars) : data });
        } catch (e) {
          if (!(e instanceof AutonomoError && e.code === "paid_not_served")) this.paid--; // that one was paid, so it counts
          return refusal(e);
        }
      },
      {
        name: "autonomo_call_api",
        description:
          "Call an Autonomo API and pay for it from this agent's wallet, then return its answer and a receipt with the " +
          "payment's transaction link. Give the slug and path from autonomo_find_apis (best), or a query and input. " +
          "The price is checked against the spending limits before anything is signed; failed calls aren't charged. " +
          "Each call costs money, so call only what the task needs.",
        schema: CALL_SCHEMA,
      },
    );
    return [...tools, call];
  }
}
