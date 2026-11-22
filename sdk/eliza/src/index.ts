// elizaOS plugin for Autonomo: an agent finds a paid API on Autonomo, sees its price and pays for a call.
//
//   import { autonomoPlugin } from "elizaos-plugin-autonomo";
//   export const projectAgent = { character, plugins: [autonomoPlugin] };
//
// The agent's wallet key and limits are read from its settings (AUTONOMO_WALLET_KEY and the others in SETTINGS
// below). The payments are made by the Autonomo SDK (autonomo-sdk on npm), with its per-call and daily caps.
//
// One build runs on elizaOS 1.x and 2.x. On 2.x the planner fills each action's parameters and writes the reply from
// the result. 1.x has no action parameters, so there the action reads them from the message with the small model and
// answers through the callback. Only types are imported from @elizaos/core, so the agent's own copy is never doubled.

import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, Plugin } from "@elizaos/core";
import { Autonomo, AutonomoError, rankApis, type Api, type AutonomoOptions, type Receipt, type TokenName } from "autonomo-sdk";

export const VERSION = "0.1.1";

const DEFAULT_MAX_OUTPUT_CHARS = 8_000;
const FIND_LIMIT = 10;

/** The settings the plugin reads, from the character's secrets or settings, or from the environment. */
export const SETTINGS = {
  walletKey: "AUTONOMO_WALLET_KEY",
  payWith: "AUTONOMO_PAY_WITH",
  maxUsdgPerCall: "AUTONOMO_MAX_USDG_PER_CALL",
  maxAutonomoPerCall: "AUTONOMO_MAX_AUTONOMO_PER_CALL",
  dailyUsdg: "AUTONOMO_DAILY_USDG",
  dailyAutonomo: "AUTONOMO_DAILY_AUTONOMO",
  borroAccount: "AUTONOMO_BORRO_ACCOUNT",
  maxOutputChars: "AUTONOMO_MAX_OUTPUT_CHARS",
  baseUrl: "AUTONOMO_BASE_URL",
} as const;

export type AutonomoPluginOptions = AutonomoOptions & {
  /** An Autonomo client you set up yourself, for example with Gloam. Used instead of the agent's settings. */
  client?: Autonomo;
  /** Longer answers are cut before they reach the model or the chat. Default 8,000 characters. */
  maxOutputChars?: number;
};

/** One agent's client. `off` says why it can't pay, when a setting is wrong. */
type Kit = { client: Autonomo; canPay: boolean; maxOutputChars: number; off?: string };

type Params = { slug?: string; path?: string; query?: string; input?: string; private?: boolean };
type Outcome = { text: string; data: Record<string, unknown> };
type Logger = { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void };

const NAMES = { find: "AUTONOMO_FIND_APIS", price: "AUTONOMO_GET_PRICE", call: "AUTONOMO_CALL_API" } as const;

// ---------- Settings ----------

function setting(runtime: IAgentRuntime, key: string): string | undefined {
  let v: unknown;
  try {
    v = runtime.getSetting(key);
  } catch {
    v = undefined;
  }
  if (v === null || v === undefined || v === "") v = typeof process !== "undefined" ? process.env?.[key] : undefined;
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || undefined;
}

const loggerOf = (runtime: IAgentRuntime): Logger => (runtime as unknown as { logger?: Logger }).logger ?? {};

/**
 * Builds an agent's client from its settings. A setting that can't be read as written turns paying off, with the
 * reason, so a typo in a limit never becomes a looser limit.
 */
function buildKit(runtime: IAgentRuntime, opts: AutonomoPluginOptions): Kit {
  const { client, maxOutputChars: optChars, ...sdk } = opts;
  const wrong: string[] = [];

  const charsRaw = setting(runtime, SETTINGS.maxOutputChars);
  let maxOutputChars = optChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  if (optChars === undefined && charsRaw !== undefined) {
    if (/^\d+$/.test(charsRaw) && Number(charsRaw) >= 200) maxOutputChars = Number(charsRaw);
    else wrong.push(`${SETTINGS.maxOutputChars} should be a whole number of 200 or more`);
  }

  if (client) {
    const gloam = (client as unknown as { gloam?: unknown }).gloam;
    return { client, canPay: Boolean(client.address || gloam), maxOutputChars };
  }

  const amount = (key: string) => {
    const v = setting(runtime, key);
    if (v === undefined) return undefined;
    if (/^\d+(\.\d+)?$/.test(v)) return v;
    wrong.push(`${key} should be a number like 0.05`);
    return undefined;
  };
  const perCall: Partial<Record<TokenName, string>> = { ...sdk.limits?.perCall };
  const daily: Partial<Record<TokenName, string>> = { ...sdk.limits?.daily };
  perCall.usdg ??= amount(SETTINGS.maxUsdgPerCall);
  perCall.autonomo ??= amount(SETTINGS.maxAutonomoPerCall);
  daily.usdg ??= amount(SETTINGS.dailyUsdg);
  daily.autonomo ??= amount(SETTINGS.dailyAutonomo);

  let payWith = sdk.payWith;
  const payRaw = setting(runtime, SETTINGS.payWith)?.toLowerCase();
  if (payWith === undefined && payRaw !== undefined) {
    if (payRaw === "usdg" || payRaw === "autonomo" || payRaw === "usdc" || payRaw === "auto") payWith = payRaw;
    else wrong.push(`${SETTINGS.payWith} should be usdg, autonomo, usdc or auto`);
  }

  let key = sdk.privateKey ?? setting(runtime, SETTINGS.walletKey);
  if (key !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(String(key).trim())) {
    wrong.push(`${SETTINGS.walletKey} should be 0x followed by 64 hex characters`);
    key = undefined;
  }

  let borro = sdk.borro;
  const borroRaw = setting(runtime, SETTINGS.borroAccount);
  if (borro === undefined && borroRaw !== undefined) {
    if (/^0x[0-9a-fA-F]{40}$/.test(borroRaw)) borro = { account: borroRaw };
    else wrong.push(`${SETTINGS.borroAccount} should be the credit line's address`);
  }

  const off = wrong.length ? `Paying is off until this is fixed in the agent's settings: ${wrong.join("; ")}.` : undefined;
  const made = new Autonomo({
    ...sdk,
    privateKey: off ? undefined : key,
    payWith,
    limits: { perCall, daily },
    borro: off ? undefined : borro,
    baseUrl: sdk.baseUrl ?? setting(runtime, SETTINGS.baseUrl),
  });
  return { client: made, canPay: !off && Boolean(made.address || sdk.gloam), maxOutputChars, off };
}

// ---------- Parameters ----------

const str = (v: unknown) => (typeof v === "string" && v.trim() && !/^(null|undefined|none)$/i.test(v.trim()) ? v.trim() : undefined);

function clean(raw: Record<string, unknown>): Params {
  return {
    slug: str(raw.slug),
    path: str(raw.path),
    query: str(raw.query),
    input: str(raw.input),
    private: raw.private === true || raw.private === "true",
  };
}

/** The parameters the planner filled in (elizaOS 2.x), or null when the runtime gave none (1.x). */
function planned(options: unknown): Params | null {
  const p = (options as { parameters?: unknown } | undefined)?.parameters;
  return p && typeof p === "object" ? clean(p as Record<string, unknown>) : null;
}

const VALUE = /0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40}|https?:\/\/[^\s<>"')\]]+/;

function firstJson(text: string): Record<string, unknown> | null {
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from < 0 || to <= from) return null;
  try {
    const v = JSON.parse(text.slice(from, to + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function ask(runtime: IAgentRuntime, prompt: string): Promise<string | null> {
  try {
    const use = (runtime as unknown as { useModel?: (type: string, params: { prompt: string }) => Promise<unknown> }).useModel;
    if (typeof use !== "function") return null;
    const out = await use.call(runtime, "TEXT_SMALL", { prompt });
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}

/**
 * For elizaOS 1.x: reads what to search for from the user's message. The value passed to the API (an address, a
 * transaction hash or a link) is only ever one that is written in the message itself, never one the model made up.
 */
async function fromMessage(runtime: IAgentRuntime, text: string): Promise<Params> {
  const found = text.match(VALUE)?.[0];
  const out = await ask(
    runtime,
    "Read the user's message and say what they need from a data API. Answer with one JSON object and nothing else:\n" +
      '{"query": "what they need, in a few words, e.g. token risk, wallet holdings, newest launches", ' +
      '"input": "the token or wallet address, transaction hash or link in the message, or null"}\n\n' +
      `User's message:\n"""\n${text.slice(0, 2000)}\n"""`,
  );
  const json = out ? firstJson(out) : null;
  const said = str(json?.input);
  return {
    query: str(json?.query) ?? text.replace(VALUE, " ").replace(/\s+/g, " ").trim().slice(0, 200),
    input: said && text.includes(said) ? said : found,
  };
}

// ---------- What the model and the user read ----------

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n[cut: the answer was ${text.length} characters, the first ${limit} are shown]`;

const priceOf = (a: Api) =>
  [
    a.price.usdg != null ? `${a.price.usdg} USDG` : null,
    a.price.autonomo != null ? `${a.price.autonomo} AUTONOMO` : null,
    a.price.usdcBase != null ? `${a.price.usdcBase} USDC on Base` : null,
  ]
    .filter(Boolean)
    .join(" or ") ||
  "price on request";

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

/**
 * The APIs for a search. With a value to pass, the SDK's ranking keeps only the APIs that take it. Without one, every
 * API is searched by its words, so "wallet holdings" finds an API before the agent has the wallet's address.
 */
function search(all: Api[], query: string, input: string | undefined): Api[] {
  if (input !== undefined) return rankApis(all, query, input);
  const words = query.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2);
  if (!words.length) return all;
  const trust = (a: Api) => (a.verified ? 1 : 0) + (a.successRate ?? 0.5);
  return all
    .map((a) => ({ a, hits: words.filter((w) => `${a.slug} ${a.name} ${a.description}`.toLowerCase().includes(w)).length }))
    .filter((s) => s.hits > 0)
    .sort((x, y) => y.hits - x.hits || trust(y.a) - trust(x.a))
    .map((s) => s.a);
}

const paidLine = (r: Receipt) => `Paid ${r.amount} ${r.token} for ${r.api.name}${r.explorer ? `: ${r.explorer}` : ""}. Spent today: ${r.spentToday}.`;

function problem(e: unknown): { code: string; message: string } {
  if (e instanceof AutonomoError) return { code: e.code, message: e.message };
  const err = e as { name?: string; message?: string };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return { code: "timeout", message: "The request to Autonomo timed out." };
  return { code: "failed", message: `The request to Autonomo failed: ${String(err?.message ?? e).slice(0, 300)}` };
}

// ---------- The plugin ----------

/**
 * Autonomo's actions for an elizaOS agent. Pass options to set the client in code (the SDK's options, or a `client`
 * you made yourself); without them, each agent's settings are read.
 */
export function createAutonomoPlugin(opts: AutonomoPluginOptions = {}): Plugin {
  const kits = new WeakMap<object, Kit>();
  const kitFor = (runtime: IAgentRuntime): Kit => {
    let kit = kits.get(runtime);
    if (!kit) {
      kit = buildKit(runtime, opts);
      kits.set(runtime, kit);
    }
    return kit;
  };
  const canGoPrivate = Boolean(opts.gloam || (opts.client as unknown as { gloam?: unknown } | undefined)?.gloam);

  /** Runs an action's work and turns it into a result. Never throws: a refusal is a result the agent can read. */
  const handler =
    (name: string, work: (ctx: { kit: Kit; runtime: IAgentRuntime; params: Params; asked: string; byPlanner: boolean }) => Promise<Outcome>) =>
    async (runtime: IAgentRuntime, message: Memory, _state?: unknown, options?: unknown, callback?: HandlerCallback): Promise<ActionResult> => {
      const text = typeof message?.content?.text === "string" ? message.content.text : "";
      const fromPlanner = planned(options);
      let out: Outcome;
      let success = true;
      try {
        const kit = kitFor(runtime);
        out = await work({ kit, runtime, params: fromPlanner ?? (await fromMessage(runtime, text)), asked: text, byPlanner: Boolean(fromPlanner) });
      } catch (e) {
        const { code, message: why } = problem(e);
        success = false;
        out = { text: why, data: { error: code, message: why } };
      }
      // On 1.x the callback is how the user gets the answer. On 2.x the planner writes the reply from the result.
      if (!fromPlanner && callback) {
        try {
          await callback({ text: out.text, actions: [name], source: message?.content?.source } as Parameters<HandlerCallback>[0]);
        } catch {
          // The result below still carries the answer.
        }
      }
      return { success, text: out.text, data: out.data, ...(success ? {} : { error: out.text }) } as ActionResult;
    };

  const text = { type: "string" as const };
  const QUERY = { name: "query", description: 'What is needed, in a few words, e.g. "is this token safe" or "wallet holdings".', required: false, schema: text };
  const PICK = { ...QUERY, description: "Used only without a slug: what is needed, to pick the best API." };
  const INPUT = { name: "input", description: "The value to pass, if any: a token or wallet address, a transaction hash or a link.", required: false, schema: text };
  const SLUG = { name: "slug", description: `The API's slug from ${NAMES.find}, e.g. token-risk.`, required: false, schema: text };
  const PATH = {
    name: "path",
    description: "The API's path with every <placeholder> filled in, e.g. /risk/0x86b5...ec49. Leave out to use the API's own path filled with input.",
    required: false,
    schema: text,
  };
  const PRIVATE = {
    name: "private",
    description: "Pay privately through Gloam. Never falls back to a public payment.",
    required: false,
    schema: { type: "boolean" as const },
  };

  const find = {
    name: NAMES.find,
    similes: ["FIND_PAID_API", "SEARCH_AUTONOMO", "LIST_AUTONOMO_APIS"],
    description:
      "Search Autonomo's paid APIs: crypto data on Robinhood Chain (token risk and prices, wallets, transactions, new launches) " +
      "and more, such as reading web pages. Free. Returns the best matches with each API's slug, what it does, its path " +
      "(with <placeholders> to fill), its price in USDG and $AUTONOMO, and its track record. Prefer verified APIs.",
    parameters: [
      { ...QUERY, description: `${QUERY.description} Leave out to list every API.` },
      { ...INPUT, description: `${INPUT.description} Only APIs that take it are shown.` },
    ],
    validate: async () => true,
    handler: handler(NAMES.find, async ({ kit, params }) => {
      const all = await kit.client.find();
      const apis = search(all, params.query ?? "", params.input).slice(0, FIND_LIMIT);
      if (!apis.length) return { text: "No Autonomo API matches. Try other words, or no query to list them all.", data: { apis: [] } };
      const lines = apis.map((a) => `- ${a.name} (${a.slug})${a.verified ? ", verified" : ""}: ${a.description}. Path ${a.path}. ${priceOf(a)} per call.`);
      return { text: `Autonomo APIs${params.query ? ` for "${params.query}"` : ""}:\n${lines.join("\n")}`, data: { apis: apis.map(apiInfo) } };
    }),
    examples: [
      [
        { name: "{{name1}}", content: { text: "What paid APIs can you use to check a token?" } },
        { name: "{{name2}}", content: { text: "Let me look at what Autonomo lists.", actions: [NAMES.find] } },
      ],
    ],
  };

  const price = {
    name: NAMES.price,
    similes: ["AUTONOMO_QUOTE", "CHECK_API_PRICE"],
    description:
      "See what one call to an Autonomo API costs, without paying: the exact URL and every way to pay it. Free. " +
      `Give the slug and path from ${NAMES.find}, or a query and input to pick the API.`,
    parameters: [SLUG, PATH, PICK, INPUT],
    validate: async () => true,
    handler: handler(NAMES.price, async ({ kit, params }) => {
      const q = await kit.client.quote(params.query ?? "", { slug: params.slug, path: params.path, input: params.input });
      // Only the ways this agent can pay: a token the SDK doesn't know shows as its contract address, and a private
      // payment needs Gloam set up.
      const offers = q.offers.filter((o) => !o.token.startsWith("0x") && (canGoPrivate || !o.private));
      if (!offers.length) throw new AutonomoError(`${q.api.name} doesn't take USDG or $AUTONOMO on Robinhood Chain, or USDC on Base, so this agent can't pay for it.`, "no_price");
      const ways = offers.map((o) => `${o.amount} ${o.token}${o.private ? " (private, through Gloam)" : ""}`).join(", or ");
      return { text: `One call to ${q.api.name} costs ${ways}. URL: ${q.url}`, data: { api: { slug: q.api.slug, name: q.api.name }, url: q.url, offers } };
    }),
    examples: [
      [
        { name: "{{name1}}", content: { text: "How much would a risk check on 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49 cost?" } },
        { name: "{{name2}}", content: { text: "I'll check the price first.", actions: [NAMES.price] } },
      ],
    ],
  };

  const call = {
    name: NAMES.call,
    similes: ["PAY_FOR_API", "CALL_PAID_API", "USE_AUTONOMO_API"],
    description:
      "Call an Autonomo API and pay for it from this agent's wallet, then return its answer and a receipt with the " +
      `payment's transaction link. Give the slug and path from ${NAMES.find} (best), or a query and input. ` +
      "The price is checked against the spending limits before anything is signed; failed calls aren't charged. " +
      "Each call costs money, so call only what the task needs.",
    parameters: [SLUG, PATH, PICK, INPUT, ...(canGoPrivate ? [PRIVATE] : [])],
    // Offered only to an agent that can pay.
    validate: async (runtime: IAgentRuntime) => {
      try {
        return kitFor(runtime).canPay;
      } catch {
        return false;
      }
    },
    handler: handler(NAMES.call, async ({ kit, runtime, params, asked, byPlanner }) => {
      if (kit.off) throw new AutonomoError(kit.off, "bad_settings");
      const { data, receipt } = await kit.client.call(params.query ?? "", {
        slug: params.slug,
        path: params.path,
        input: params.input,
        private: canGoPrivate && params.private ? true : undefined,
      });
      // A long answer is cut to fit the model's context; the payment was for the whole answer either way.
      const raw = typeof data === "string" ? data : JSON.stringify(data);
      const answer = raw.length > kit.maxOutputChars ? clip(raw, kit.maxOutputChars) : data;
      const shown = typeof answer === "string" ? answer : raw;
      const result = { api: receipt.api, receipt, answer };
      if (byPlanner) return { text: `${receipt.api.name} answered:\n${shown}\n\n${paidLine(receipt)}`, data: result };
      // 1.x: the small model words the answer from the data. What was paid is always added as the receipt has it.
      const worded = await ask(
        runtime,
        `The user asked:\n"""\n${asked.slice(0, 2000)}\n"""\n\nThe API "${receipt.api.name}" returned the data below. Answer the user in a few short sentences, ` +
          `using only this data. Don't add values that aren't in it, and don't mention payments.\n\nData:\n${clip(shown, Math.min(kit.maxOutputChars, 6000))}`,
      );
      return { text: `${worded ?? `${receipt.api.name} answered:\n${shown}`}\n\n${paidLine(receipt)}`, data: result };
    }),
    examples: [
      [
        { name: "{{name1}}", content: { text: "Is this token safe? 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49" } },
        { name: "{{name2}}", content: { text: "I'll run a paid risk check on it.", actions: [NAMES.call] } },
      ],
      [
        { name: "{{name1}}", content: { text: "What launched on Robinhood Chain today?" } },
        { name: "{{name2}}", content: { text: "Checking the newest launches.", actions: [NAMES.call] } },
      ],
    ],
  };

  return {
    name: "autonomo",
    description: "Find, price and pay for Autonomo's x402 APIs in USDG or $AUTONOMO on Robinhood Chain, or USDC on Base, within spending caps.",
    init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
      const log = loggerOf(runtime);
      try {
        const kit = kitFor(runtime);
        if (kit.off) log.warn?.(`[autonomo] ${kit.off}`);
        else if (kit.canPay) log.info?.(`[autonomo] Ready to pay${kit.client.address ? ` from ${kit.client.address}` : " through Gloam"}.`);
        else log.info?.(`[autonomo] No ${SETTINGS.walletKey} set: the agent can find APIs and check prices, not pay.`);
      } catch (e) {
        log.warn?.(`[autonomo] ${problem(e).message}`);
      }
    },
    actions: [find, price, call] as Action[],
  };
}

/** The plugin with every agent's own settings. */
export const autonomoPlugin: Plugin = createAutonomoPlugin();
export default autonomoPlugin;
