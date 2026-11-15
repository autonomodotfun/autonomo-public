// The rules a launched API's fields must pass. Shared by the one-at-a-time launch form and "Launch several at once",
// so the two can't drift apart. Pure functions: nothing here touches the database or the network.

import type { UpstreamTest } from "@/lib/gateway";

export const FORBIDDEN_HEADERS = new Set(["host", "content-length", "cookie", "connection", "transfer-encoding", "payment-signature"]);

/** What's wrong with a paid address, or null. Whether it is already taken is checked against the database. */
export function slugError(slug: string, reserved: Set<string>): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return "3–40 lowercase letters, numbers or dashes.";
  return reserved.has(slug) ? "That name is reserved." : null;
}

export const usdPriceValid = (v: string) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0 && Number(v) <= 100;

// $AUTONOMO prices are automatic: they follow the API's dollar price, 20% lower, at the token's average price over the
// previous UTC day (src/lib/pool-price.ts), and are worked out again every day.
export const AUTONOMO_DISCOUNT = 0.2;
export const AUTONOMO_DISCOUNT_LABEL = `${AUTONOMO_DISCOUNT * 100}% off`;
export const AUTONOMO_PRICE_NOTE = "Follows your dollar price, 20% lower, at the 24-hour average. Updates daily.";

/** Whole $AUTONOMO tokens a call costs for a dollar price, at a token price in USD. Never less than 1. */
export function autonomoAmountFor(priceUsd: number, tokenUsd: number): string {
  if (!(priceUsd > 0) || !(tokenUsd > 0)) throw new Error("autonomoAmountFor needs two prices above zero");
  return String(Math.max(1, Math.round((priceUsd * (1 - AUTONOMO_DISCOUNT)) / tokenUsd)));
}

/**
 * The dollar price an API that only had a $AUTONOMO amount moves over with: what that amount is worth today, before
 * the discount, so its $AUTONOMO price stays where it was on the day it switched.
 */
export function usdPriceFromAmount(amount: number, tokenUsd: number): string {
  const usd = (amount * tokenUsd) / (1 - AUTONOMO_DISCOUNT);
  return String(Math.min(100, Math.max(0.000001, Number(usd.toFixed(6)))));
}

type PricedGateway = { id: number; priceUsd: string; autonomoAmount: string | null };

/**
 * The daily repricing: the new $AUTONOMO amount for every API that accepts it, at today's token price. An API that only
 * had a $AUTONOMO amount, with no dollar price, first gets the dollar price that amount is worth today. Only APIs whose
 * numbers change are returned.
 */
export function planReprice(rows: PricedGateway[], tokenUsd: number) {
  const changes: { id: number; priceUsd: string; autonomoAmount: string; was: string }[] = [];
  for (const g of rows) {
    if (g.autonomoAmount === null) continue;
    const hadDollars = Number(g.priceUsd) > 0;
    const priceUsd = hadDollars ? g.priceUsd : usdPriceFromAmount(Number(g.autonomoAmount), tokenUsd);
    const autonomoAmount = autonomoAmountFor(Number(priceUsd), tokenUsd);
    if (autonomoAmount !== g.autonomoAmount || priceUsd !== g.priceUsd) changes.push({ id: g.id, priceUsd, autonomoAmount, was: g.autonomoAmount });
  }
  return changes;
}

/** What a $AUTONOMO call is worth in dollars, for showing beside the amount: "about $0.008". */
export const autonomoUsdHint = (amount: number, tokenUsd: number) => `about $${Number((amount * tokenUsd).toPrecision(2))}`;
export const headerNameValid = (h: string) => /^[A-Za-z0-9-]{1,64}$/.test(h) && !FORBIDDEN_HEADERS.has(h.toLowerCase());

/** Whether a test call shows an API that can be launched: it answered, didn't refuse the call and didn't fail. */
export function testVerdict(t: UpstreamTest): { pass: boolean; text: string } {
  if (!t.ok) return { pass: false, text: t.error };
  if (t.status === 401 || t.status === 403) return { pass: false, text: `It answered ${t.status}, which means it refused the call. Check the header name and key.` };
  if (t.status >= 500) return { pass: false, text: `It answered ${t.status}, an error on its own side.` };
  if (t.status >= 400) return { pass: true, text: `It answered ${t.status} in ${t.ms} ms. Fine if this path isn't a real one.` };
  return { pass: true, text: `It answered ${t.status} in ${t.ms} ms.` };
}
