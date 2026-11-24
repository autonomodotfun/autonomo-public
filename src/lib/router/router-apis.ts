import type { Gateway } from "@/db/schema";
import { TOKEN } from "@/lib/constants";
import {
  CAPABILITIES, ROUTER, checkAnswer, fillPath, isCapability, isNoData, mapAnswer, notReadyWait, validPathTemplate,
  type ApiAnswer, type Capability, type FieldMapping, type RoutableApi,
} from "@/lib/router/router";
import { OFFICIAL_OWNER } from "@/lib/directory/track-record";

// Which APIs the router can send calls to, and how a routed request becomes a call to each one. Kept free of
// server-only imports so it can be tested on its own; the database read is in router-gateway.ts.

/** How one API serves a capability: the path a request becomes, and where the standard fields are in its answer. */
export type RouteSettings = { capability: Capability; path: string; mapping: FieldMapping | null };

/**
 * Autonomo's own APIs, by gateway slug. They answer in their own field names, so each has a mapping. These are used
 * when an official API has no settings saved on its row; saved settings win.
 */
export const OFFICIAL_ROUTES: Record<string, RouteSettings> = {
  "token-lookup": {
    capability: "token-price",
    path: "/price/{token}?chain={chain}",
    mapping: { price_usd: "priceUsd", source: "source", as_of: "updatedAt" },
  },
  "token-risk": {
    capability: "token-risk",
    path: "/risk/{token}?chain={chain}",
    mapping: { score: "risk.score", level: "risk.level", flags: "risk.flags" },
  },
  "holders-bundles": {
    capability: "token-holders",
    path: "/holders/{token}?chain={chain}",
    mapping: { top_holders: "topHolders", linked_groups: "linkedGroups", snipers: "snipers.buyers" },
  },
  "website-check": {
    capability: "website-check",
    path: "/site?url={url}",
    mapping: { verdict: "caution", reasons: "flags" },
  },
  // Only the quote is routed. The agent then builds that quote with a direct call to the same API, which the
  // X-Autonomo-Routed-To header names: a quote can only be built by the API that signed it.
  "safe-swap": {
    capability: "swap-quote",
    path: "/swap/quote?token_in={token_in}&token_out={token_out}&amount_in={amount}&taker={taker}&slippage_bps={slippage_bps}",
    mapping: { quote_id: "quote_id", min_out: "min_out", risk: "verdict" },
  },
};

type SettingsRow = Pick<Gateway, "slug" | "owner" | "routeCapability" | "routePath" | "routeMapping">;

/** An API's routing settings: the ones saved on its row, or for an official API the ones above. Null: not routable. */
export function routeSettings(g: SettingsRow): RouteSettings | null {
  const preset = g.owner === OFFICIAL_OWNER ? OFFICIAL_ROUTES[g.slug] : undefined;
  const capability = g.routeCapability ?? preset?.capability;
  const path = g.routePath ?? preset?.path;
  if (!capability || !isCapability(capability) || !path || !validPathTemplate(path)) return null;
  // A saved capability other than the preset's doesn't get the preset's mapping.
  const mapping = g.routeMapping ?? (preset && preset.capability === capability ? preset.mapping : null);
  return { capability, path, mapping };
}

type ApiRow = SettingsRow & Pick<Gateway, "payTo" | "priceUsd" | "status" | "listing" | "routeFormatOk" | "routeListedAt" | "createdAt">;

/** A gateway as the router sees it, or null when it serves no capability. */
export function toRoutableApi(g: ApiRow): { api: RoutableApi; settings: RouteSettings } | null {
  const settings = routeSettings(g);
  if (!settings) return null;
  const api: RoutableApi = {
    slug: g.slug,
    capability: settings.capability,
    priceUsd: Number(g.priceUsd),
    payTo: (g.payTo ?? g.owner).toLowerCase(),
    official: g.owner === OFFICIAL_OWNER,
    launched: g.status === "active",
    formatOk: g.routeFormatOk,
    unlisted: g.listing !== "listed",
    mapping: settings.mapping,
    listedAt: (g.routeListedAt ?? g.createdAt).getTime(),
    apiOfTheWeek: false,
  };
  return { api, settings };
}

// A payment that settled on Robinhood Chain, used as the known input for payment-check.
const KNOWN_PAYMENT = "0xfd8a1c8c76410ec259ae171fe21a4438657ae579642c4ec2cd38966565dc574e";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
// Autonomo's Safe, the wallet the published Safe Swap example is quoted for. A quote moves nothing.
const QUOTE_TAKER = "0x92a99fbd386f87277b6009bff4c56728ec5f7354";

/**
 * Inputs that always have an answer, for the format test, and for a probe when no agent's input can be used: the
 * service isn't replayed (REPLAY_INPUTS in router.ts), or nobody has paid for a call on it yet.
 */
export const PROBE_INPUTS: Record<Capability, Record<string, string>> = {
  "token-price": { token: TOKEN.address, chain: "robinhood" },
  "token-risk": { token: TOKEN.address, chain: "robinhood" },
  "token-holders": { token: TOKEN.address, chain: "robinhood" },
  "dev-wallet": { token: TOKEN.address, chain: "robinhood" },
  "website-check": { url: "https://autonomo.fun" },
  "payment-check": { tx_hash: KNOWN_PAYMENT, chain: "robinhood" },
  "job-finder": {},
  // 1 USDG, in base units, into the Autonomo token.
  "swap-quote": { token_in: USDG, token_out: TOKEN.address, amount: "1000000", taker: QUOTE_TAKER },
};

/** `wait` is set when the API said "not ready yet": the seconds it asked for before the next call. */
export type FormatTest = { ok: boolean; reason: string; status: number | null; ms: number | null; wait?: number };

/**
 * The format test an API passes before it can be routed: one call with the known input for its capability, which
 * must come back 2xx with every required field. `call` sends the request the way a routed call would be sent.
 * A probe may give its own `inputs`.
 */
export async function formatTest(
  settings: RouteSettings,
  call: (path: string) => Promise<ApiAnswer>,
  inputs: Record<string, string> = PROBE_INPUTS[settings.capability],
): Promise<FormatTest> {
  const filled = fillPath(settings.path, inputs);
  if (!filled.ok) return { ok: false, reason: filled.error, status: null, ms: null };
  const { status, body, ms, retryAfter } = await call(filled.path);
  const wait = notReadyWait(status, retryAfter);
  if (wait !== null) return { ok: false, reason: `the API says it is not ready yet: run the test again in ${wait} seconds`, status, ms, wait };
  if (status < 200 || status >= 300) return { ok: false, reason: `the API answered ${status}`, status, ms };
  if (body === null || body === undefined) return { ok: false, reason: "the answer is not JSON", status, ms };
  const check = checkAnswer(settings.capability, mapAnswer(body, settings.mapping));
  return { ok: check.valid, reason: check.reason, status, ms };
}

/**
 * `notReady`: the API said "not ready yet". `noData`: it said it has no answer for the input (a 4xx). `real`: the
 * agent's input the probe used, null when it used the fixed one. recordProbe() in router.ts decides what counts.
 */
export type ProbeResult = { valid: boolean; reason: string; ms: number | null; notReady: boolean; noData: boolean; real: { capability: string; inputs: Record<string, string> } | null };

/**
 * One probe of an API: the format test's call, held to the gateway's time limit as well. With `inputs`, an input an
 * agent paid for, the API is asked for that; when its path can't be filled from them, or none are given, the fixed
 * input is used. On the fixed input a 4xx is a failure, since that input is known to have an answer.
 */
export async function probeApi(settings: RouteSettings, call: Parameters<typeof formatTest>[1], inputs?: Record<string, string> | null): Promise<ProbeResult> {
  const usable = inputs && fillPath(settings.path, inputs).ok ? inputs : null;
  const real = usable ? { capability: settings.capability, inputs: usable } : null;
  const t = await formatTest(settings, call, usable ?? undefined);
  if (t.ok && t.ms !== null && t.ms > ROUTER.gatewayLimitMs) return { valid: false, reason: "too slow", ms: t.ms, notReady: false, noData: false, real };
  return { valid: t.ok, reason: t.reason, ms: t.ms, notReady: t.wait !== undefined, noData: t.status !== null && isNoData(t.status), real };
}

const FIELD_PATH = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;

/**
 * Checks routing settings typed into a form: a known capability, a path template, and a mapping written as JSON
 * (or left empty when the API already answers with the standard field names).
 */
export function parseRouteSettings(capability: string, path: string, mappingText: string): { ok: true; settings: RouteSettings } | { ok: false; error: string } {
  if (!isCapability(capability)) return { ok: false, error: "Pick a capability from the list." };
  const template = path.trim();
  if (!validPathTemplate(template)) return { ok: false, error: "The path has to start with / and name inputs in braces, like /price/{token}?chain={chain}." };
  const text = mappingText.trim();
  if (!text) return { ok: true, settings: { capability, path: template, mapping: null } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The mapping isn\'t valid JSON. It looks like {"price_usd": "data.usd"}.' };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "The mapping has to be a JSON object." };
  const fields = Object.keys(CAPABILITIES[capability]);
  const mapping: FieldMapping = {};
  for (const [name, where] of Object.entries(parsed)) {
    if (!fields.includes(name)) return { ok: false, error: `${name} is not a field of ${capability}. Its fields are ${fields.join(", ")}.` };
    if (typeof where !== "string" || where.length > 100 || !FIELD_PATH.test(where)) return { ok: false, error: `The place given for ${name} isn't a path like data.usd.` };
    mapping[name] = where;
  }
  return { ok: true, settings: { capability, path: template, mapping: Object.keys(mapping).length ? mapping : null } };
}
