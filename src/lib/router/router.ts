import { randomBytes } from "node:crypto";

// The Autonomo Router: an agent asks for a service ("the price of this token") and the router picks the API that
// serves it. This file is the routing logic only: capabilities and the answer check, the record of measured calls,
// eligibility, tiers and the score, route ids, the fallback to the next API and the 24-hour pause on payers whose
// settlement failed.
//
// Kept free of server-only imports, like track-record.ts, so it can be tested on its own. What already lives in the
// gateway is passed in as functions (see RouteHooks): building the 402, verifying the payment, calling the API and
// settling. Where the record is kept is passed in too (see RouterStore); memoryStore() is the one the tests use.
//
// Every time here is in milliseconds, as everywhere else in the site.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------- settings ----------

export const ROUTER = {
  /** The answer rate is taken over the last 20 measured calls... */
  measuredWindow: 20,
  /** ...none older than 30 days. */
  measuredMaxAgeMs: 30 * DAY,
  minAnswerRate: 0.95,
  uptimeWindowMs: 7 * DAY,
  /** A slashed wallet's APIs are not routed for 30 days. */
  slashQuietMs: 30 * DAY,
  /**
   * Probes cost nothing, so a new API gets 10 a day until it has its 20 measured calls: two days instead of a week.
   * The fast rate stops after 3 days whatever happened, a day to spare for probes that ran late or weren't ready.
   * After that: 3 a day while it can't be routed on its record, otherwise 1 a day.
   */
  newApiMs: 3 * DAY,
  probesPerDayNew: 10,
  probesPerDayCatchingUp: 3,
  probesPerDay: 1,
  uptimeProbeEveryMs: 15 * MINUTE,
  weights: { answer: 0.6, speed: 0.3, uptime: 0.1 },
  /** Full marks for speed at 1 s or less, none at 10 s. A service that is slower by nature has its own marks: CAPABILITY_SPEED. */
  speedFullMs: 1 * SECOND,
  speedZeroMs: 10 * SECOND,
  /**
   * The longest wait an API may ask for when it says "not ready yet" (a 503 with Retry-After). A longer one is an
   * API that is down, and counts as a failure.
   */
  notReadyMaxWaitMs: 2 * MINUTE,
  /** APIs within 10% of the best score share the traffic. */
  spread: 0.1,
  /** A bonded API keeps its priority only up to twice the cheapest eligible price. */
  tier1MaxPriceRatio: 2,
  apiOfTheWeekBonus: 1.05,
  routeIdTtlMs: 60 * SECOND,
  /** After the first API, at most 2 more. */
  maxRetries: 2,
  payerBlockMs: 24 * HOUR,
  /**
   * One payer's routed calls count once per API per day, good or bad: the first of its UTC day. At 95% of 20 calls
   * an API can afford exactly one failure, so one is the most a single wallet may take from it. And one is the most
   * a single wallet may add, or a creator could lift its own API's record by paying for calls through the router.
   */
  maxCallsPerPayerDay: 1,
  bondCacheMs: 5 * MINUTE,
  /**
   * How long an API's saved stats are used before they are worked out again. They are also cleared whenever its
   * record changes, so this only covers what time alone changes: calls leaving the 30-day and 7-day windows.
   */
  statsMaxAgeMs: 15 * MINUTE,
  /** The gateway's own limit on an upstream call. */
  gatewayLimitMs: 25 * SECOND,
  /** The payment signature must stay valid for the limit plus 30 s, so it still holds when the gateway settles. */
  signatureMarginMs: 30 * SECOND,
  /**
   * Requests to /route a minute. A "no answer" costs the agent nothing and can chain to three APIs, so without a
   * limit junk inputs could hammer creators' servers. Per wallet for paid requests, once the payment has verified;
   * per address for every request, since new wallets are free. A paid call is two requests: the 402, then the payment.
   */
  ratePerPayerPerMinute: 60,
  ratePerIpPerMinute: 240,
} as const;

// ---------- capabilities ----------

// What each required field must be. "list" is a list with at least one item, "list0" a list that may be empty, "num"
// a number (or a string holding one), "str" a non-empty string, "bool" true or false, "any" anything but null or "".
type FieldKind = "num" | "str" | "bool" | "any" | "list" | "list0";

export const CAPABILITIES = {
  "token-price": { price_usd: "num", source: "str", as_of: "any" },
  "token-risk": { score: "num", level: "str", flags: "list0" },
  "token-holders": { top_holders: "list", linked_groups: "list0", snipers: "list0" },
  "dev-wallet": { dev: "str", claimed_fees: "num", sells: "list0", funded_by: "any" },
  "website-check": { verdict: "str", reasons: "list0" },
  "payment-check": { confirmed: "bool", amount: "num", from: "str", to: "str" },
  "job-finder": { jobs: "list0" },
  "swap-quote": { quote_id: "str", min_out: "any", risk: "any" },
} as const satisfies Record<string, Record<string, FieldKind>>;

export type Capability = keyof typeof CAPABILITIES;

export const isCapability = (name: string): name is Capability => Object.prototype.hasOwnProperty.call(CAPABILITIES, name);

/** Standard field name -> where it is in the API's own answer, as a dotted path. A number steps into a list. */
export type FieldMapping = Record<string, string>;

/** Reads a dotted path such as "risk.score" or "payments.0.from" from a JSON value. Null when it isn't there. */
function readPath(value: unknown, path: string): unknown {
  let cur = value;
  for (const part of path.split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (cur !== null && typeof cur === "object" && !Array.isArray(cur) && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = (cur as Record<string, unknown>)[part];
    } else return null;
  }
  return cur ?? null;
}

/**
 * Turns an API's own answer into the standard fields. No mapping means the API already answers with the standard
 * field names, so its answer is used as it is.
 */
export function mapAnswer(raw: unknown, mapping: FieldMapping | null | undefined): unknown {
  if (!mapping || Object.keys(mapping).length === 0) return raw;
  return Object.fromEntries(Object.entries(mapping).map(([standard, path]) => [standard, readPath(raw, path)]));
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function isNumber(v: unknown) {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && DECIMAL.test(v.trim()) && Number.isFinite(Number(v));
}

export type AnswerCheck = { valid: boolean; reason: string };

/** Whether an answer is valid for its capability: every required field is there, not empty, and the right kind. */
export function checkAnswer(capability: string, answer: unknown): AnswerCheck {
  if (!isCapability(capability)) return { valid: false, reason: `unknown capability ${capability}` };
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return { valid: false, reason: "answer is not a JSON object" };
  const fields = CAPABILITIES[capability] as Record<string, FieldKind>;
  const got = answer as Record<string, unknown>;
  for (const [name, kind] of Object.entries(fields)) {
    const v = got[name];
    if (v === null || v === undefined || v === "") return { valid: false, reason: `missing ${name}` };
    if (kind === "num" && !isNumber(v)) return { valid: false, reason: `${name} is not a number` };
    if (kind === "str" && !(typeof v === "string" && v.trim())) return { valid: false, reason: `${name} is empty` };
    if (kind === "bool" && typeof v !== "boolean") return { valid: false, reason: `${name} is not true/false` };
    if (kind === "list" && !(Array.isArray(v) && v.length > 0)) return { valid: false, reason: `${name} is empty` };
    if (kind === "list0" && !Array.isArray(v)) return { valid: false, reason: `${name} is not a list` };
  }
  if (capability === "token-risk") {
    const score = Number(got.score);
    if (!(score >= 0 && score <= 100)) return { valid: false, reason: "score out of 0-100" };
  }
  return { valid: true, reason: "ok" };
}

// ---------- "not ready yet" ----------

// An API can say "not ready yet, come back in N seconds": a 503 with a Retry-After header. Safe Swap does when a
// token's checks are still running; the next call finds them done. That is not a failure. The agent isn't charged,
// the call isn't counted, and the agent is told when to call the same API again. If the API says it a second time,
// that one counts.

export const NOT_READY = "not ready yet";
export const STILL_NOT_READY = "not ready after waiting";

/** A Retry-After header as seconds. Only a plain number of seconds is read, not a date. */
export function parseRetryAfter(value: string | null | undefined): number | null {
  const text = value?.trim() ?? "";
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

/** The wait in seconds an API asked for by answering "not ready yet", or null when its answer is anything else. */
export function notReadyWait(status: number, retryAfter: number | null | undefined): number | null {
  if (status !== 503 || retryAfter === null || retryAfter === undefined || !(retryAfter > 0)) return null;
  const seconds = Math.ceil(retryAfter);
  return seconds * SECOND <= ROUTER.notReadyMaxWaitMs ? seconds : null;
}

// ---------- the APIs and their record ----------

export type RoutableApi = {
  slug: string;
  capability: string;
  /** The list price of one call in USD, whatever it is paid in. */
  priceUsd: number;
  /** The creator's pay-to wallet from the database, the one the bond is on. */
  payTo: string;
  /** Autonomo's own APIs, which never get tier 1. */
  official: boolean;
  /** Goes through the gateway. Directory-only APIs are not routed. */
  launched: boolean;
  /** Passed the format test for its capability. */
  formatOk: boolean;
  unlisted: boolean;
  mapping: FieldMapping | null;
  /** When it became routable, which starts its days of 10 probes a day. */
  listedAt: number;
  apiOfTheWeek: boolean;
};

/** One measured call: a call the router sent to an API, or a paid probe. Direct calls by name are never measured. */
export type MeasuredCall = {
  slug: string;
  at: number;
  valid: boolean;
  ms: number | null;
  kind: "routed" | "probe";
  /** Lowercased payer wallet, "" for a probe. */
  payer: string;
  settled: boolean;
  reason: string;
  /**
   * Whether it can be part of the answer rate. False for a "no answer for this input" and for a first "not ready
   * yet", which are kept but not counted.
   */
  counted: boolean;
};

/**
 * An API already tried for a request, and whether it said it had no answer for the input (a 4xx). `readyAt` is set
 * instead when the API said "not ready yet": the time it asked to be called again. That API is not done with: the
 * route is for one more call to it, after that time.
 */
export type Tried = { slug: string; noData: boolean; readyAt?: number };

export type Route = {
  id: string;
  capability: string;
  inputs: Record<string, string>;
  slug: string;
  tried: Tried[];
  expires: number;
};

/**
 * Where the router's record is kept: memoryStore() below, and the database one in router-store.ts. Both are held to
 * the same tests (router-store.test.ts).
 * takeRoute() has to be atomic, so that two requests with the same route id can't both get the route.
 *
 * A store also keeps a copy of each API's stats (saveStats, savedStats), so a request doesn't count an API's calls
 * again each time. The store itself clears an API's copy whenever its record changes: a counted call, an uptime
 * probe, or a slash of the API or of its wallet. Nothing else has to remember to.
 */
export interface RouterStore {
  /** Saves the stats worked out for an API at a time. A copy worked out later than this one is not replaced. */
  saveStats(api: Pick<RoutableApi, "slug" | "payTo">, stats: Stats, at: number): Promise<void>;
  /** The saved stats of these APIs, by slug, leaving out copies worked out before `since` and ones that were cleared. */
  savedStats(slugs: string[], since: number): Promise<Map<string, Stats>>;
  recordCall(call: MeasuredCall): Promise<void>;
  /**
   * The newest counted calls of an API since a time, newest first, at most `limit`. Of one payer's routed calls on
   * one UTC day, valid or not, only the first `maxCallsPerPayerDay` are in it. Probes are never capped. The cap is
   * applied here, when reading, and not when a call is recorded: calls sent at the same moment can't slip past a
   * rule that looks at all of them.
   */
  countedCalls(slug: string, since: number, limit: number, maxCallsPerPayerDay: number): Promise<MeasuredCall[]>;
  /** How many paid probes an API got since a time. */
  probesSince(slug: string, since: number): Promise<number>;
  /** An API's newest probe, counted or not. Null when it has none. */
  lastProbe(slug: string): Promise<MeasuredCall | null>;
  recordUptime(slug: string, up: boolean, at: number): Promise<void>;
  uptime(slug: string, since: number): Promise<{ up: number; total: number }>;
  lastUptime(slug: string): Promise<number | null>;
  recordSlash(slug: string, payTo: string, at: number): Promise<void>;
  /** The latest slash of this API or of its pay-to wallet. A slash hits the wallet, so it covers all its APIs. */
  lastSlash(slug: string, payTo: string): Promise<number | null>;
  blockPayer(payer: string, until: number): Promise<void>;
  blockedUntil(payer: string): Promise<number | null>;
  saveRoute(route: Route): Promise<void>;
  /** Routes not yet used or expired for the same capability and the same inputs, newest first. */
  openRoutes(capability: string, inputs: Record<string, string>, now: number): Promise<Route[]>;
  /** Uses a route id once. Null if it is unknown, expired or already used. */
  takeRoute(id: string, now: number): Promise<Route | null>;
  /** Counts one more request for a caller in a minute, and returns how many that makes. Atomic, like takeRoute(). */
  countHit(key: string, minute: number): Promise<number>;
}

/** A store in memory, for tests and local runs. */
export function memoryStore(): RouterStore {
  const calls: MeasuredCall[] = [];
  const uptime: { slug: string; at: number; up: boolean }[] = [];
  const slashes: { slug: string; payTo: string; at: number }[] = [];
  const blocked = new Map<string, number>();
  const routes = new Map<string, Route & { used: boolean }>();
  const hits = new Map<string, number>();
  const saved = new Map<string, { payTo: string; stats: Stats; at: number }>();
  const max = (times: number[]) => (times.length ? Math.max(...times) : null);
  const canonical = (inputs: Record<string, string>) => JSON.stringify(Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    async saveStats(api, stats, at) {
      const now = saved.get(api.slug);
      if (!now || now.at <= at) saved.set(api.slug, { payTo: api.payTo.toLowerCase(), stats: { ...stats }, at });
    },
    async savedStats(slugs, since) {
      return new Map(slugs.flatMap((slug): [string, Stats][] => {
        const hit = saved.get(slug);
        return hit && hit.at >= since ? [[slug, { ...hit.stats }]] : [];
      }));
    },
    async recordCall(call) {
      calls.push({ ...call, payer: call.payer.toLowerCase() });
      if (call.counted) saved.delete(call.slug);
    },
    async countedCalls(slug, since, limit, maxCallsPerPayerDay) {
      // Oldest first, to number each payer's routed calls through its day; rows recorded at the same time keep the
      // order they were recorded in.
      const rows = calls
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.slug === slug && c.counted && c.at >= since)
        .sort((a, b) => a.c.at - b.c.at || a.i - b.i);
      const seen = new Map<string, number>();
      const kept = rows.filter(({ c }) => {
        if (c.kind !== "routed") return true;
        const key = `${c.payer}:${Math.floor(c.at / DAY)}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        return seen.get(key)! <= maxCallsPerPayerDay;
      });
      return kept.reverse().slice(0, limit).map(({ c }) => c);
    },
    async probesSince(slug, since) {
      return calls.filter((c) => c.slug === slug && c.kind === "probe" && c.at >= since).length;
    },
    async lastProbe(slug) {
      // The newest; of two recorded at the same time, the one recorded last.
      return calls.reduce<MeasuredCall | null>((last, c) => (c.slug === slug && c.kind === "probe" && (!last || c.at >= last.at) ? c : last), null);
    },
    async recordUptime(slug, up, at) {
      uptime.push({ slug, at, up });
      saved.delete(slug);
    },
    async uptime(slug, since) {
      const rows = uptime.filter((u) => u.slug === slug && u.at >= since);
      return { up: rows.filter((u) => u.up).length, total: rows.length };
    },
    async lastUptime(slug) {
      return max(uptime.filter((u) => u.slug === slug).map((u) => u.at));
    },
    async recordSlash(slug, payTo, at) {
      const wallet = payTo.toLowerCase();
      slashes.push({ slug, payTo: wallet, at });
      for (const [s, hit] of saved) if (s === slug || hit.payTo === wallet) saved.delete(s);
    },
    async lastSlash(slug, payTo) {
      const wallet = payTo.toLowerCase();
      return max(slashes.filter((s) => s.slug === slug || s.payTo === wallet).map((s) => s.at));
    },
    async blockPayer(payer, until) {
      blocked.set(payer.toLowerCase(), until);
    },
    async blockedUntil(payer) {
      return blocked.get(payer.toLowerCase()) ?? null;
    },
    async saveRoute(route) {
      routes.set(route.id, { ...route, used: false });
    },
    async openRoutes(capability, inputs, now) {
      const same = canonical(inputs);
      return [...routes.values()]
        .filter((r) => !r.used && r.expires > now && r.capability === capability && canonical(r.inputs) === same)
        .sort((a, b) => b.expires - a.expires)
        .map(({ used: _used, ...route }) => route);
    },
    async takeRoute(id, now) {
      const hit = routes.get(id);
      if (!hit || hit.used || hit.expires <= now) return null;
      hit.used = true;
      const { used: _used, ...route } = hit;
      return route;
    },
    async countHit(key, minute) {
      const k = `${key}@${minute}`;
      hits.set(k, (hits.get(k) ?? 0) + 1);
      return hits.get(k)!;
    },
  };
}

/**
 * Records a measured call: a call the router sent to an API, or a paid probe. Direct calls by name are left out on
 * purpose: a creator could pay its own API from fresh wallets for a few cents and fake a perfect record. With routed
 * calls, the router decides who gets the call, not the creator.
 */
export async function recordMeasured(store: RouterStore, call: Omit<MeasuredCall, "counted"> & { counted?: boolean }) {
  if (call.kind !== "routed" && call.kind !== "probe") throw new Error("only routed calls and paid probes are measured");
  await store.recordCall({ ...call, payer: call.payer.toLowerCase(), counted: call.counted ?? true });
}

export type Stats = {
  measured: number;
  valid: number;
  answerRate: number;
  medianMs: number | null;
  /** Share of uptime probes answered over the last 7 days; 1 while there are none. */
  uptime: number;
  lastSlash: number | null;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function statsFor(store: RouterStore, api: Pick<RoutableApi, "slug" | "payTo">, now: number): Promise<Stats> {
  const [rows, up, lastSlash] = await Promise.all([
    store.countedCalls(api.slug, now - ROUTER.measuredMaxAgeMs, ROUTER.measuredWindow, ROUTER.maxCallsPerPayerDay),
    store.uptime(api.slug, now - ROUTER.uptimeWindowMs),
    store.lastSlash(api.slug, api.payTo),
  ]);
  const valid = rows.filter((r) => r.valid);
  return {
    measured: rows.length,
    valid: valid.length,
    answerRate: rows.length ? valid.length / rows.length : 0,
    medianMs: median(valid.flatMap((r) => (r.ms === null ? [] : [r.ms]))),
    uptime: up.total ? up.up / up.total : 1,
    lastSlash,
  };
}

/** Works an API's stats out from its record and saves the copy that requests read. */
export async function refreshStats(store: RouterStore, api: Pick<RoutableApi, "slug" | "payTo">, now: number): Promise<Stats> {
  const stats = await statsFor(store, api, now);
  await store.saveStats(api, stats, now);
  return stats;
}

/**
 * The stats of several APIs, by slug, in one read: the saved copies. An API with no fresh copy (it is new, its
 * record just changed, or nothing refreshed it for 15 minutes) is worked out from its record and saved.
 */
export async function statsOf(store: RouterStore, apis: Pick<RoutableApi, "slug" | "payTo">[], now: number): Promise<Map<string, Stats>> {
  if (!apis.length) return new Map();
  const board = await store.savedStats(apis.map((a) => a.slug), now - ROUTER.statsMaxAgeMs);
  const missing = apis.filter((a) => !board.has(a.slug));
  const fresh = await Promise.all(missing.map((a) => refreshStats(store, a, now)));
  missing.forEach((a, i) => board.set(a.slug, fresh[i]));
  return board;
}

// ---------- choosing ----------

export function eligible(api: RoutableApi, st: Stats, now: number) {
  if (!api.launched || !api.formatOk || api.unlisted || !(api.priceUsd > 0)) return false;
  if (st.lastSlash !== null && now - st.lastSlash < ROUTER.slashQuietMs) return false;
  return st.measured >= ROUTER.measuredWindow && st.answerRate >= ROUTER.minAnswerRate;
}

/**
 * Speed marks for services whose answers take longer by nature. APIs only compete inside their own service, so each
 * service can have its own idea of fast. The others use the general marks in ROUTER.
 */
export const CAPABILITY_SPEED: Partial<Record<Capability, { fullMs: number; zeroMs: number }>> = {
  // A quote runs its token checks before it answers. No marks at the gateway's limit, past which a call fails anyway.
  "swap-quote": { fullMs: 5 * SECOND, zeroMs: ROUTER.gatewayLimitMs },
};

/**
 * 1 when the median answer takes 1 s or less, falling in a straight line to 0 at 10 s, or between the service's own
 * marks when it has them.
 */
export function speed(medianMs: number | null, capability?: string) {
  if (medianMs === null) return 0;
  const own = capability && isCapability(capability) ? CAPABILITY_SPEED[capability] : undefined;
  const fullMs = own?.fullMs ?? ROUTER.speedFullMs;
  const zeroMs = own?.zeroMs ?? ROUTER.speedZeroMs;
  if (medianMs <= fullMs) return 1;
  if (medianMs >= zeroMs) return 0;
  return (zeroMs - medianMs) / (zeroMs - fullMs);
}

export type BondCheck = (wallet: string, now: number) => Promise<boolean>;

/**
 * Wraps a bond lookup so each wallet is asked for once every 5 minutes. If the lookup fails, the wallet counts as
 * not bonded: its APIs fall back to tier 2, they are never blocked.
 */
export function cachedBond(fetchBonded: (wallet: string) => Promise<boolean> | boolean): BondCheck {
  const cache = new Map<string, { at: number; bonded: boolean }>();
  return async (wallet, now) => {
    const w = wallet.toLowerCase();
    const hit = cache.get(w);
    if (hit && now - hit.at < ROUTER.bondCacheMs) return hit.bonded;
    let bonded = false;
    try {
      bonded = Boolean(await fetchBonded(w));
    } catch {
      bonded = false;
    }
    if (cache.size > 2000) cache.clear();
    cache.set(w, { at: now, bonded });
    return bonded;
  };
}

export type Router = {
  store: RouterStore;
  /** The routable APIs, from the database. */
  apis: () => Promise<RoutableApi[]> | RoutableApi[];
  isBonded: BondCheck;
  /** A number in [0, 1), like Math.random. */
  random: () => number;
};

export function createRouter(opts: { store: RouterStore; apis: Router["apis"]; isBonded: BondCheck; random?: () => number }): Router {
  return { store: opts.store, apis: opts.apis, isBonded: opts.isBonded, random: opts.random ?? Math.random };
}

export type Candidate = { api: RoutableApi; stats: Stats; tier: 1 | 2; score: number };

/** Every eligible API for a capability, with its tier and score, best first. */
export async function candidates(router: Router, capability: string, now: number, exclude: string[] = []): Promise<Candidate[]> {
  const serving = (await router.apis()).filter((api) => api.capability === capability && !exclude.includes(api.slug));
  const board = await statsOf(router.store, serving, now);
  const pool = serving.flatMap((api) => {
    const stats = board.get(api.slug)!;
    return eligible(api, stats, now) ? [{ api, stats }] : [];
  });
  if (!pool.length) return [];
  const cheapest = Math.min(...pool.map((p) => p.api.priceUsd));
  const out: Candidate[] = [];
  for (const { api, stats } of pool) {
    const w = ROUTER.weights;
    const quality = w.answer * stats.answerRate + w.speed * speed(stats.medianMs, api.capability) + w.uptime * stats.uptime;
    // The square root keeps price important without letting an API win on price alone.
    const priceFactor = Math.sqrt(cheapest / api.priceUsd);
    const score = quality * priceFactor * (api.apiOfTheWeek ? ROUTER.apiOfTheWeekBonus : 1);
    // Tier 1: bonded, not Autonomo's own, and priced at most twice the cheapest eligible API.
    const bonded = !api.official && api.priceUsd <= ROUTER.tier1MaxPriceRatio * cheapest && (await router.isBonded(api.payTo, now));
    out.push({ api, stats, tier: bonded ? 1 : 2, score });
  }
  return out.sort((a, b) => a.tier - b.tier || b.score - a.score);
}

/** The best tier first. Inside it, APIs within 10% of the best score share the call, weighted by score. */
export async function pick(router: Router, capability: string, now: number, exclude: string[] = []): Promise<Candidate | null> {
  const all = await candidates(router, capability, now, exclude);
  if (!all.length) return null;
  const same = all.filter((c) => c.tier === all[0].tier);
  const close = same.filter((c) => c.score >= same[0].score * (1 - ROUTER.spread));
  if (close.length === 1) return close[0];
  const weights = close.map((c) => Math.max(c.score, 1e-9));
  let at = router.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < close.length; i++) {
    at -= weights[i];
    if (at < 0) return close[i];
  }
  return close[close.length - 1];
}

// ---------- probes ----------

/**
 * APIs that need a probe now. 10 a day while a new API has fewer than 20 measured calls, so it gets there in two days
 * without having traffic first (for 3 days at most). 3 a day whenever it can't be routed on its record, so one that
 * failed gets back in days instead of weeks. Otherwise 1 a day. Spread over the day: a probe is due once
 * 24 h / probes-per-day has passed since the last.
 */
export async function probesDue(router: Router, now: number): Promise<RoutableApi[]> {
  const due: RoutableApi[] = [];
  for (const api of await router.apis()) {
    if (!api.launched || !api.formatOk || api.unlisted) continue;
    // Its last probe heard "not ready yet": it is asked once more, after the longest wait an API may ask for.
    const last = await router.store.lastProbe(api.slug);
    if (last && !last.counted) {
      if (now - last.at >= ROUTER.notReadyMaxWaitMs) due.push(api);
      continue;
    }
    const st = await statsFor(router.store, api, now);
    const onRecord = st.measured >= ROUTER.measuredWindow && st.answerRate >= ROUTER.minAnswerRate;
    let perDay: number = onRecord ? ROUTER.probesPerDay : ROUTER.probesPerDayCatchingUp;
    if (now - api.listedAt < ROUTER.newApiMs && st.measured < ROUTER.measuredWindow) perDay = ROUTER.probesPerDayNew;
    if ((await router.store.probesSince(api.slug, now - DAY / perDay)) === 0) due.push(api);
  }
  return due;
}

/**
 * Puts a probe on the record. An API that says "not ready yet" isn't marked down for it the first time: that probe
 * is kept but not counted, and probesDue() asks once more after the wait. The second answer counts whatever it is,
 * so an API can't stay "not ready" for ever. Returns true when the probe is waiting for that second answer.
 */
export async function recordProbe(router: Router, slug: string, probe: { valid: boolean; reason: string; ms: number | null; notReady?: boolean }, now: number) {
  const last = probe.notReady ? await router.store.lastProbe(slug) : null;
  const askedBefore = last !== null && !last.counted;
  const waiting = probe.notReady === true && !askedBefore;
  const reason = waiting ? NOT_READY : probe.notReady ? STILL_NOT_READY : probe.reason;
  await recordMeasured(router.store, { slug, at: now, valid: probe.valid && !probe.notReady, ms: probe.ms, kind: "probe", payer: "", settled: false, reason, counted: !waiting });
  return waiting;
}

// ---------- slashes ----------

/** The record's name for a slash of a whole wallet. An API's slug can't hold a colon, so it never matches one. */
const walletSlash = (wallet: string) => `wallet:${wallet.toLowerCase()}`;

/**
 * Puts slashes that ran on the bond contract on the record, so the slashed wallet's APIs are not routed for 30 days.
 * `at` is when the slash ran. The whole list can be given every time: a slash already on the record is not added
 * again. Returns the wallets it added a slash for.
 */
export async function recordSlashes(store: RouterStore, executed: { provider: string; at: number }[]): Promise<string[]> {
  const latest = new Map<string, number>();
  for (const s of executed) {
    const wallet = s.provider.toLowerCase();
    latest.set(wallet, Math.max(latest.get(wallet) ?? 0, s.at));
  }
  const added: string[] = [];
  for (const [wallet, at] of latest) {
    const known = await store.lastSlash(walletSlash(wallet), wallet);
    if (known !== null && known >= at) continue;
    await store.recordSlash(walletSlash(wallet), wallet, at);
    added.push(wallet);
  }
  return added;
}

/** APIs whose free uptime probe is due: every 15 minutes, sent straight to the API's own server. */
export async function uptimeDue(router: Router, now: number): Promise<RoutableApi[]> {
  const due: RoutableApi[] = [];
  for (const api of await router.apis()) {
    if (!api.launched || api.unlisted) continue;
    const last = await router.store.lastUptime(api.slug);
    if (last === null || now - last >= ROUTER.uptimeProbeEveryMs) due.push(api);
  }
  return due;
}

// ---------- the rate limit ----------

/** Counts this request for a caller and says whether it is past the limit for the current minute. */
export async function overLimit(store: RouterStore, key: string, perMinute: number, now: number) {
  return (await store.countHit(key, Math.floor(now / MINUTE) * MINUTE)) > perMinute;
}

// ---------- inputs ----------

/**
 * The inputs a capability can't be asked without. Anything else, such as `chain`, is optional. A swap quote needs
 * the wallet that will sign the swap (`taker`): the quote is built for that wallet, and `amount` is in base units.
 */
export const CAPABILITY_INPUTS: Record<Capability, string[]> = {
  "token-price": ["token"],
  "token-risk": ["token"],
  "token-holders": ["token"],
  "dev-wallet": ["token"],
  "website-check": ["url"],
  "payment-check": ["tx_hash"],
  "job-finder": [],
  "swap-quote": ["token_in", "token_out", "amount", "taker"],
};

export const missingInputs = (capability: Capability, inputs: Record<string, string>) =>
  CAPABILITY_INPUTS[capability].filter((name) => !inputs[name]?.trim());

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

/** Whether a path template can be saved: it starts with "/", has no spaces, and only names inputs in its braces. */
export function validPathTemplate(template: string) {
  return template.startsWith("/") && template.length <= 300 && !/\s/.test(template) && !/[{}]/.test(template.replace(PLACEHOLDER, ""));
}

/**
 * Turns a routed request's inputs into the path of one API, from that API's template, such as
 * "/price/{token}?chain={chain}". An input in the path itself is required. One in the query is optional: when it
 * isn't given, that part of the query is left out. Inputs the template doesn't name are not sent.
 */
export function fillPath(template: string, inputs: Record<string, string>): { ok: true; path: string } | { ok: false; error: string } {
  if (!validPathTemplate(template)) return { ok: false, error: "bad path template" };
  const cut = template.indexOf("?");
  const [pathPart, queryPart] = cut < 0 ? [template, ""] : [template.slice(0, cut), template.slice(cut + 1)];
  let problem = "";
  const path = pathPart.replace(PLACEHOLDER, (_, name: string) => {
    const value = inputs[name]?.trim() ?? "";
    // "." and ".." would step out of the API's own path once the address is resolved.
    if (!value || value === "." || value === "..") problem ||= `missing or bad input ${name}`;
    return encodeURIComponent(value);
  });
  if (problem) return { ok: false, error: problem };
  const query = queryPart
    .split("&")
    .filter(Boolean)
    .flatMap((pair) => {
      const names = [...pair.matchAll(PLACEHOLDER)].map((m) => m[1]);
      if (names.some((name) => !inputs[name]?.trim())) return [];
      return [pair.replace(PLACEHOLDER, (_, name: string) => encodeURIComponent(inputs[name].trim()))];
    })
    .join("&");
  return { ok: true, path: query ? `${path}?${query}` : path };
}

// ---------- one routed request ----------

export type Outcome = { status: number; body: unknown; headers: Record<string, string> };

/** What a call to an API came back with. */
export type ApiAnswer = { status: number; body: unknown; ms: number | null; retryAfter?: number | null };

/**
 * What the gateway plugs in. `validForSeconds` is how long the payment signature must stay valid, to be used as the
 * payment's maxTimeoutSeconds.
 */
export type RouteHooks<Payment> = {
  /** The 402 body for that API: its own price and its own pay-to, plus the route id. */
  paymentRequired: (api: RoutableApi, routeId: string, validForSeconds: number) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Checks signature, amount, pay-to and balance. Nothing moves. It must refuse a payment made out to another API. */
  verify: (payment: Payment, api: RoutableApi) => Promise<{ ok: boolean; payer: string }> | { ok: boolean; payer: string };
  /**
   * Calls the API. `body` is its parsed JSON answer, or null when there is none. `retryAfter` is the API's
   * Retry-After header in seconds, when it sent one.
   */
  callApi: (api: RoutableApi, inputs: Record<string, string>) => Promise<ApiAnswer> | ApiAnswer;
  /** Moves the money. True only if it went through. */
  settle: (payment: Payment, api: RoutableApi) => Promise<boolean> | boolean;
};

type RequiredHook = Pick<RouteHooks<never>, "paymentRequired">;

/** How long the agent's payment signature must stay valid: the gateway's limit plus the margin, in seconds. */
export const paymentValiditySeconds = () => Math.floor((ROUTER.gatewayLimitMs + ROUTER.signatureMarginMs) / SECOND);

const routeHeaders = (routeId: string, slug: string) => ({ "X-Autonomo-Route-Id": routeId, "X-Autonomo-Routed-To": slug });
const refuse = (status: number, error: string): Outcome => ({ status, body: { error }, headers: {} });

async function newRoute(router: Router, capability: string, inputs: Record<string, string>, slug: string, tried: Tried[], now: number, expires = now + ROUTER.routeIdTtlMs) {
  const route: Route = { id: randomBytes(18).toString("base64url"), capability, inputs, slug, tried, expires };
  await router.store.saveRoute(route);
  return route.id;
}

/** First step, no payment yet: pick an API and answer 402 with its price and a route id. */
export async function startRoute(
  router: Router,
  capability: string,
  inputs: Record<string, string>,
  now: number,
  hooks: RequiredHook,
  tried: Tried[] = [],
): Promise<Outcome> {
  if (!isCapability(capability)) {
    return { status: 404, body: { error: `unknown capability ${capability}`, capabilities: Object.keys(CAPABILITIES).sort() }, headers: {} };
  }
  const missing = missingInputs(capability, inputs);
  if (missing.length) return { status: 400, body: { error: `missing input: ${missing.join(", ")}`, inputs: CAPABILITY_INPUTS[capability] }, headers: {} };
  const chosen = await pick(router, capability, now, tried.map((t) => t.slug));
  if (!chosen) return { status: 503, body: { error: "no API can serve this right now", capability }, headers: {} };
  const id = await newRoute(router, capability, inputs, chosen.api.slug, tried, now);
  return { status: 402, body: await hooks.paymentRequired(chosen.api, id, paymentValiditySeconds()), headers: routeHeaders(id, chosen.api.slug) };
}

// The second step, when the agent comes back with its payment, is in four parts. routePaidCall() below runs them in
// order with the gateway's verify and settle as functions. The gateway's own route runs them around its payment
// wrapper, which verifies before a handler and settles after it (src/lib/router/router-gateway.ts).

export type Opened = { ok: true; route: Route; api: RoutableApi } | { ok: false; outcome: Outcome };

/** Uses the route id once and finds the API it was for. */
export async function openRoute(router: Router, routeId: string, now: number, apiBySlug: (slug: string) => RoutableApi | undefined): Promise<Opened> {
  const route = await router.store.takeRoute(routeId, now);
  if (!route) return { ok: false, outcome: refuse(400, "route_id unknown, expired or already used: call /route again") };
  const api = apiBySlug(route.slug);
  if (!api) return { ok: false, outcome: refuse(400, "that API is gone: call /route again") };
  return { ok: true, route, api };
}

/**
 * For a client that sent a payment without the route id: finds the route it must be answering, from the request it
 * repeats and the API its payment is made out to (`paysFor`). The newest one that fits is used.
 */
export async function openRouteByPayment(
  router: Router,
  capability: string,
  inputs: Record<string, string>,
  now: number,
  apiBySlug: (slug: string) => RoutableApi | undefined,
  paysFor: (api: RoutableApi) => Promise<boolean> | boolean,
): Promise<Opened> {
  for (const open of await router.store.openRoutes(capability, inputs, now)) {
    const api = apiBySlug(open.slug);
    if (api && (await paysFor(api))) {
      const opened = await openRoute(router, open.id, now, apiBySlug);
      if (opened.ok) return opened;
    }
  }
  return { ok: false, outcome: refuse(400, "no open route for this payment: call /route again") };
}

/** The payment didn't verify. The route id is used up, so a fresh one is given for the same API and the agent can pay again. */
export async function refusePayment(router: Router, route: Route, api: RoutableApi, now: number, hooks: RequiredHook): Promise<Outcome> {
  // A route that waits for an API to be ready lives longer than 60 seconds, and its replacement must too.
  const id = await newRoute(router, route.capability, route.inputs, api.slug, route.tried, now, Math.max(now + ROUTER.routeIdTtlMs, route.expires));
  const required = await hooks.paymentRequired(api, id, paymentValiditySeconds());
  return { status: 402, body: { ...required, error: "payment not valid for this route" }, headers: routeHeaders(id, api.slug) };
}

/**
 * The API said "not ready yet", or the agent came back before the wait was over: a 503 that says when to call again,
 * with a route for the same API that can be paid from then until 60 seconds later. Nothing was charged.
 */
async function comeBackLater(router: Router, route: Route, api: RoutableApi, readyAt: number, now: number, hooks: RequiredHook): Promise<Outcome> {
  const tried = [...route.tried.filter((t) => t.slug !== api.slug), { slug: api.slug, noData: false, readyAt }];
  const id = await newRoute(router, route.capability, route.inputs, api.slug, tried, now, readyAt + ROUTER.routeIdTtlMs);
  const seconds = Math.max(1, Math.ceil((readyAt - now) / SECOND));
  const next = await hooks.paymentRequired(api, id, paymentValiditySeconds());
  return {
    status: 503,
    body: { error: `${api.slug} is not ready yet, nothing was charged: call again in ${seconds} seconds`, retry_after_seconds: seconds, next },
    headers: { ...routeHeaders(id, api.slug), "Retry-After": String(seconds) },
  };
}

export type Served = { ok: true; body: unknown; ms: number | null } | { ok: false; outcome: Outcome };

/**
 * The payment verified: call the API and check its answer. Nothing has settled yet. A bad answer is recorded and
 * the next API is offered; a good one is returned for the caller to settle, then finishRoute().
 */
export async function serveRoute<Payment>(
  router: Router,
  route: Route,
  api: RoutableApi,
  payer: string,
  now: number,
  hooks: Pick<RouteHooks<Payment>, "paymentRequired" | "callApi">,
): Promise<Served> {
  const blockedUntil = await router.store.blockedUntil(payer);
  if (blockedUntil !== null && blockedUntil > now) {
    return { ok: false, outcome: refuse(403, "this wallet is paused for 24 hours after a failed settlement") };
  }

  // This route is the second call to an API that said "not ready yet". Before the time it gave, the API isn't
  // called at all: an agent that comes back early can't make the API fail its second chance.
  const waitedFor = route.tried.find((t) => t.slug === api.slug && t.readyAt !== undefined);
  if (waitedFor && now < waitedFor.readyAt!) return { ok: false, outcome: await comeBackLater(router, route, api, waitedFor.readyAt!, now, hooks) };

  const called = await hooks.callApi(api, route.inputs);
  const { status, ms } = called;
  const wait = notReadyWait(status, called.retryAfter);
  if (wait !== null && !waitedFor) {
    await recordMeasured(router.store, { slug: api.slug, at: now, ms, kind: "routed", payer, valid: false, settled: false, reason: NOT_READY, counted: false });
    return { ok: false, outcome: await comeBackLater(router, route, api, now + wait * SECOND, now, hooks) };
  }
  const raw = called.body ?? null;
  const answer = raw === null ? null : mapAnswer(raw, api.mapping);
  // A 4xx means the API has no answer for this input (unknown token, bad address). Except 408 and 429: a timeout or
  // "too many requests" is the API's own problem.
  const noData = status >= 400 && status < 500 && status !== 408 && status !== 429;
  let check: AnswerCheck = status >= 200 && status < 300 && raw !== null ? checkAnswer(api.capability, answer) : { valid: false, reason: `status ${status}` };
  if (check.valid && ms !== null && ms > ROUTER.gatewayLimitMs) check = { valid: false, reason: "too slow" };
  // "Not ready yet" a second time, after the wait it asked for: a failure like any other.
  if (wait !== null) check = { valid: false, reason: STILL_NOT_READY };

  if (check.valid) {
    // With a mapping, the agent gets the standard fields and the API's whole answer beside them, so nothing is lost.
    const mapped = api.mapping && Object.keys(api.mapping).length > 0;
    return { ok: true, body: mapped ? { ...(answer as Record<string, unknown>), raw } : answer, ms };
  }

  // An API fault (5xx, timeout, empty or broken answer) counts against the API. A "no answer for this input" is
  // kept on the record but not counted: the input may be the problem, and counting it would let anyone push an API
  // out with junk inputs. Paid probes use inputs that always have an answer, so an API that answers 4xx to
  // everything still fails its probes.
  await recordMeasured(router.store, { slug: api.slug, at: now, ms, kind: "routed", payer, valid: false, settled: false, reason: check.reason, counted: !noData });
  const tried = [...route.tried.filter((t) => t.slug !== api.slug), { slug: api.slug, noData }];
  const failed = `${api.slug} failed (${check.reason}), nothing was charged`;
  if (tried.length > ROUTER.maxRetries) {
    return { ok: false, outcome: { status: 502, body: { error: "no valid answer after retries, nothing was charged", tried: tried.map((t) => t.slug) }, headers: {} } };
  }
  const next = await startRoute(router, route.capability, route.inputs, now, hooks, tried);
  if (next.status === 402) return { ok: false, outcome: { status: 502, body: { error: failed, next: next.body }, headers: next.headers } };
  return { ok: false, outcome: refuse(502, `${failed}, no other API left`) };
}

export type Finished = { ok: true; headers: Record<string, string> } | { ok: false; outcome: Outcome };

/**
 * After settling a served answer. If the money moved, the call goes on the record and the answer can be returned.
 * If it didn't, there is no answer and the wallet is paused, so it can't make APIs work for free on purpose.
 * `pausePayer` is false when the failure wasn't the payer's doing, such as the payment service being down.
 */
export async function finishRoute(
  router: Router,
  api: RoutableApi,
  payer: string,
  ms: number | null,
  settled: boolean,
  now: number,
  pausePayer = true,
): Promise<Finished> {
  await recordMeasured(router.store, { slug: api.slug, at: now, ms, kind: "routed", payer, valid: true, settled, reason: settled ? "ok" : "settlement failed" });
  if (!settled) {
    if (pausePayer) await router.store.blockPayer(payer, now + ROUTER.payerBlockMs);
    return { ok: false, outcome: { status: 402, body: { error: "settlement failed, no answer returned" }, headers: {} } };
  }
  const bonded = !api.official && (await router.isBonded(api.payTo, now));
  return { ok: true, headers: { "X-Autonomo-Routed-To": api.slug, "X-Autonomo-Bonded": bonded ? "true" : "false" } };
}

/**
 * The whole second step, with verify and settle as functions. The answer is checked before anything settles, a bad
 * answer is never charged, and the answer is only returned once the money moved.
 */
export async function routePaidCall<Payment>(
  router: Router,
  routeId: string,
  payment: Payment,
  now: number,
  apiBySlug: (slug: string) => RoutableApi | undefined,
  hooks: RouteHooks<Payment>,
): Promise<Outcome> {
  const opened = await openRoute(router, routeId, now, apiBySlug);
  if (!opened.ok) return opened.outcome;
  const { route, api } = opened;
  const { ok, payer } = await hooks.verify(payment, api);
  if (!ok) return refusePayment(router, route, api, now, hooks);
  const served = await serveRoute(router, route, api, payer, now, hooks);
  if (!served.ok) return served.outcome;
  const finished = await finishRoute(router, api, payer, served.ms, await hooks.settle(payment, api), now);
  if (!finished.ok) return finished.outcome;
  return { status: 200, body: served.body, headers: finished.headers };
}
