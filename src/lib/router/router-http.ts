import {
  ROUTER, finishRoute, fillPath, isCapability, openRoute, openRouteByPayment, overLimit, refusePayment, serveRoute, startRoute,
  type ApiAnswer, type Outcome, type RoutableApi, type RouteHooks, type Router, type Served,
} from "@/lib/router/router";
import type { RouteSettings } from "@/lib/router/router-apis";

// GET /route/<capability>?<inputs>: the router as a paid HTTP route. This file turns one request into the steps in
// router.ts. Everything that touches the gateway is passed in (RouteDeps), so the flow can be tested with a fake
// payment wrapper; the real one is in router-gateway.ts.
//
// The payment itself is left to the same x402 wrapper the gateway uses for direct calls: it answers 402 without a
// valid payment, otherwise it runs a handler and settles only when that handler answers below 400. So a routed call
// is that wrapper around a handler that calls the API and checks its answer: a bad answer is a 502, and never settles.

/** One routable API: how the router sees it, how to call it, and the gateway row `G` behind it. */
export type Routable<G> = { api: RoutableApi; settings: RouteSettings; gateway: G };

export type RouteDeps<G> = {
  router: Router;
  now: () => number;
  /** The routable APIs. */
  load: () => Promise<Routable<G>[]>;
  /** The 402 for a gateway, as the payment wrapper answers a request that carries no payment. */
  required: (gateway: G, request: Request) => Promise<Response>;
  /**
   * The payment wrapper for a gateway. Without a valid payment for that gateway it answers 402 and `inner` never
   * runs. Otherwise it runs `inner`, and settles only if `inner` answers below 400.
   */
  paid: (gateway: G, request: Request, inner: () => Promise<Response>) => Promise<Response>;
  /** Whether a payment, by the requirements it accepted, is made out to this gateway. */
  paysFor: (gateway: G, accepted: Record<string, unknown>) => Promise<boolean> | boolean;
  /** Calls the API behind a gateway at a path. `body` is its parsed JSON answer, or null. */
  call: (gateway: G, path: string) => Promise<ApiAnswer>;
  /** Called once a request that carried a payment got its answer, to log it like any other paid call. */
  onPaid?: (gateway: G, request: Request, response: Response, startedAt: number, path: string) => void;
};

const JSON_HEADERS = { "Content-Type": "application/json" };
// Settlement failures the payer caused: the balance was moved, the signature was already used or cancelled, the
// Permit2 approval was withdrawn, or the transfer itself reverted.
const PAYER_FAULT = /insufficient_balance|nonce|allowance_required|transaction_failed|simulation_failed/;
const MAX_INPUTS = 12;
const MAX_INPUT_CHARS = 2000;

function decodeHeader(value: string | null): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const json = (out: Outcome) => new Response(JSON.stringify(out.body), { status: out.status, headers: { ...JSON_HEADERS, ...out.headers } });

/** A wrapper's response with the router's body and headers on it: its payment headers stay as the wrapper set them. */
function withOutcome(base: Response, out: Outcome) {
  const headers = new Headers(base.headers);
  headers.delete("content-length");
  for (const [k, v] of Object.entries({ ...JSON_HEADERS, ...out.headers })) headers.set(k, v);
  return new Response(JSON.stringify(out.body), { status: out.status, headers });
}

function withHeaders(base: Response, extra: Record<string, string>) {
  const out = new Response(base.body, { status: base.status, headers: base.headers });
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}

/** The request's inputs: its query, one value per name. */
function readInputs(url: URL): Record<string, string> | null {
  const inputs: Record<string, string> = {};
  for (const [name, value] of url.searchParams) {
    if (name in inputs) continue;
    if (Object.keys(inputs).length >= MAX_INPUTS || value.length > MAX_INPUT_CHARS) return null;
    inputs[name] = value;
  }
  return inputs;
}

const tooMany = () => new Response(JSON.stringify({ error: "too many requests: wait a minute" }), { status: 429, headers: { ...JSON_HEADERS, "Retry-After": "60" } });

/** `ip` is the caller's address when it is known, for the rate limit. */
export async function handleRoute<G>(request: Request, capability: string, deps: RouteDeps<G>, ip?: string | null): Promise<Response> {
  const { router } = deps;
  const now = deps.now();
  if (!isCapability(capability)) return json(await startRoute(router, capability, {}, now, { paymentRequired: () => ({}) }));
  if (ip && (await overLimit(router.store, `ip:${ip}`, ROUTER.ratePerIpPerMinute, now))) return tooMany();
  const inputs = readInputs(new URL(request.url));
  if (!inputs) return json({ status: 400, body: { error: "too many inputs, or one is too long" }, headers: {} });

  const all = await deps.load();
  const bySlug = new Map(all.map((r) => [r.api.slug, r]));
  const apiBySlug = (slug: string) => bySlug.get(slug)?.api;
  // The 402 each route id was given, kept for this request so its payment headers can go out as the wrapper made them.
  const issued = new Map<string, Response>();
  const hooks: Pick<RouteHooks<never>, "paymentRequired" | "callApi"> = {
    async paymentRequired(api, routeId) {
      const res = await deps.required(bySlug.get(api.slug)!.gateway, request);
      // Anything but a 402 means the payment options couldn't be built just now (the payment service is down).
      if (res.status !== 402) throw new Error(`payment requirements unavailable for ${api.slug} (${res.status})`);
      issued.set(routeId, res);
      return { ...(decodeHeader(res.headers.get("payment-required")) ?? {}), route_id: routeId, routed_to: api.slug };
    },
    async callApi(api, callInputs) {
      const { gateway, settings } = bySlug.get(api.slug)!;
      const filled = fillPath(settings.path, callInputs);
      // The inputs don't fit this API's path: its own fault for being routable this way, but nothing to count.
      if (!filled.ok) return { status: 400, body: { error: filled.error }, ms: null };
      return deps.call(gateway, filled.path);
    },
  };
  /** A 402 from the router: the wrapper's own 402 for that API, with the route id added. */
  const respond402 = (out: Outcome) => {
    const base = issued.get(out.headers["X-Autonomo-Route-Id"]);
    return base ? withOutcome(base, out) : json(out);
  };

  const paymentHeader = request.headers.get("payment-signature") ?? request.headers.get("x-payment");

  // ---- first step: no payment yet ----
  if (!paymentHeader) {
    const out = await startRoute(router, capability, inputs, now, hooks);
    return out.status === 402 ? respond402(out) : json(out);
  }

  // ---- second step: the request came back with a payment ----
  const payment = decodeHeader(paymentHeader);
  const routeId = request.headers.get("x-autonomo-route-id");
  const accepted = (payment?.accepted ?? {}) as Record<string, unknown>;
  const opened = routeId
    ? await openRoute(router, routeId, now, apiBySlug)
    : await openRouteByPayment(router, capability, inputs, now, apiBySlug, (api) => deps.paysFor(bySlug.get(api.slug)!.gateway, accepted));
  if (!opened.ok) return json(opened.outcome);
  const { route, api } = opened;
  if (route.capability !== capability) return json({ status: 400, body: { error: "this route_id is for another capability: call /route again" }, headers: {} });
  const { gateway } = bySlug.get(api.slug)!;

  // Who signed the payment. The wrapper has verified the signature by the time the handler below runs.
  const auth = payment?.payload?.authorization ?? payment?.payload?.permit2Authorization ?? {};
  const payer = typeof auth.from === "string" ? auth.from.toLowerCase() : "";
  const startedAt = Date.now();
  const state: { served: Served | null; limited: boolean } = { served: null, limited: false };
  const res = await deps.paid(gateway, request, async () => {
    // The wallet's own limit is counted here, once its payment has verified, so nobody can use up another wallet's
    // allowance by putting its address on a payment they can't sign. A 429 is not settled.
    if (payer && (await overLimit(router.store, `payer:${payer}`, ROUTER.ratePerPayerPerMinute, now))) {
      state.limited = true;
      return tooMany();
    }
    state.served = await serveRoute(router, route, api, payer, now, hooks);
    return state.served.ok ? new Response(JSON.stringify(state.served.body), { status: 200, headers: JSON_HEADERS }) : json(state.served.outcome);
  });
  const { served } = state;
  if (state.limited) return res;

  // The handler never ran: the payment didn't verify. On a 402 the agent gets a fresh route id for the same API.
  if (!served) {
    if (res.status !== 402) return res;
    const out = await refusePayment(router, route, api, now, hooks);
    return withOutcome(res, out);
  }
  deps.onPaid?.(gateway, request, res, startedAt, new URL(request.url).pathname);

  // The API was called and its answer wasn't valid, it isn't ready yet, or the wallet is paused: nothing settled.
  if (!served.ok) return withHeaders(res, served.outcome.headers);

  const settlement = decodeHeader(res.headers.get("payment-response") ?? res.headers.get("x-payment-response"));
  const settled = res.status < 400 && settlement?.success === true;
  // A wallet is only paused when the failure is its own doing: the money or the signature was no longer there when
  // it came to settling. If the payment service itself failed, the agent gets no answer but keeps its access.
  const payerFault = PAYER_FAULT.test(String(settlement?.errorReason ?? ""));
  const finished = await finishRoute(router, api, payer, served.ms, settled, now, payerFault, route);
  // The answer only goes out once the money moved. If the wrapper already answered with the failure, that is kept.
  if (!finished.ok) return res.status >= 400 ? res : json(finished.outcome);
  return withHeaders(res, finished.headers);
}
