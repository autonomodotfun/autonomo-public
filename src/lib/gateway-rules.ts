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
export const autonomoAmountValid = (v: string) => /^\d+(\.\d{1,18})?$/.test(v) && Number(v) > 0;
export const headerNameValid = (h: string) => /^[A-Za-z0-9-]{1,64}$/.test(h) && !FORBIDDEN_HEADERS.has(h.toLowerCase());

/** Whether a test call shows an API that can be launched: it answered, didn't refuse the call and didn't fail. */
export function testVerdict(t: UpstreamTest): { pass: boolean; text: string } {
  if (!t.ok) return { pass: false, text: t.error };
  if (t.status === 401 || t.status === 403) return { pass: false, text: `It answered ${t.status}, which means it refused the call. Check the header name and key.` };
  if (t.status >= 500) return { pass: false, text: `It answered ${t.status}, an error on its own side.` };
  if (t.status >= 400) return { pass: true, text: `It answered ${t.status} in ${t.ms} ms. Fine if this path isn't a real one.` };
  return { pass: true, text: `It answered ${t.status} in ${t.ms} ms.` };
}
