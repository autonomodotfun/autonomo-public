import { NextResponse } from "next/server";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export function json(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: HEADERS });
}

export function options() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

// What agents and apps get while the site is being updated (e.g. the database is briefly unavailable): a clear 503
// they can retry, instead of a bare 500. Never cached, so the API recovers the moment the site does.
export const UPDATING = {
  error: "temporarily_unavailable",
  message: "Autonomo is being updated right now. Please check back later.",
  retryAfter: 60,
};

export function updating(extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(UPDATING, {
    status: 503,
    headers: { ...HEADERS, ...extraHeaders, "Cache-Control": "no-store", "Retry-After": String(UPDATING.retryAfter) },
  });
}

/** Wraps a route handler so unexpected failures answer with updating() instead of a 500. */
export function withUpdating<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      console.error(e);
      return updating();
    }
  };
}
