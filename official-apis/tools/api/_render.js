// Runs a page in a real browser and returns the finished HTML, for pages that are built by their own JavaScript
// (files starting with "_" aren't routes). The browser is Cloudflare's Browser Run: one request to its /content
// endpoint, which loads the page, runs its scripts and hands back the page as a visitor's browser would hold it.
//
// Env:
//   CLOUDFLARE_ACCOUNT_ID      The Cloudflare account the browser time is billed to.
//   CLOUDFLARE_BROWSER_TOKEN   An API token of that account with one permission, "Browser Run - Edit".
//                              (CLOUDFLARE_API_KEY is read too.) Without both, nothing is rendered and Page Reader
//                              answers as it did before.
//   PAGE_RENDER_DAILY_MAX      Optional. Most pages one running copy of this API renders in a UTC day (default 2000).
//
// What goes to Cloudflare: the page's address, and nothing else about the caller. The page is loaded from
// Cloudflare's network, never ours, and always says it is a bot, so a site that turns automated browsers away
// still can't be read.

const ENDPOINT = (account) => `https://api.cloudflare.com/client/v4/accounts/${account}/browser-run/content`;
const MAX_HTML = 2_000_000;
// Pictures, video and fonts say nothing a reader needs, and skipping them is most of a page's weight.
const SKIP = ["image", "media", "font"];

const account = () => (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
const token = () => (process.env.CLOUDFLARE_BROWSER_TOKEN ?? process.env.CLOUDFLARE_API_KEY ?? "").trim();

/** Whether a browser is set up to render pages in. */
export const renderReady = () => Boolean(account() && token());

// A soft brake, per running copy of the API: a caller pays more for a page than the browser time costs, so this
// only guards against a fault that renders in a loop.
const used = { day: "", count: 0 };
const dailyMax = () => {
  const n = Number(process.env.PAGE_RENDER_DAILY_MAX);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
};
function underDailyMax(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (used.day !== day) Object.assign(used, { day, count: 0 });
  if (used.count >= dailyMax()) return false;
  used.count++;
  return true;
}
/** For the tests: forget what was counted today. */
export const resetRenderCount = () => Object.assign(used, { day: "", count: 0 });

/**
 * The page's HTML after its scripts ran: { html, ms } or { failed }, where `failed` says why in one word:
 * not_set_up, daily_limit, busy (the browser's own rate limit), timeout, refused (the browser couldn't load it)
 * or error. It never throws, so a page that can't be rendered still gets the answer it had.
 */
export async function renderPage(url, { timeoutMs = 14_000, fetchImpl = fetch } = {}) {
  if (!renderReady()) return { failed: "not_set_up" };
  if (timeoutMs < 4_000) return { failed: "timeout" };
  if (!underDailyMax()) return { failed: "daily_limit" };
  const started = Date.now();
  try {
    const res = await fetchImpl(ENDPOINT(account()), {
      method: "POST",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      // "networkidle2": the page has stopped asking for things, bar a couple of long-lived connections.
      body: JSON.stringify({ url, gotoOptions: { waitUntil: "networkidle2", timeout: Math.max(2_000, timeoutMs - 2_000) }, rejectResourceTypes: SKIP }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) return { failed: "busy" };
    const body = await res.json().catch(() => null);
    const html = typeof body?.result === "string" ? body.result : null;
    if (!res.ok || body?.success === false || !html) {
      // Cloudflare says a page that didn't finish loading in its own words; anything else is the browser refusing it.
      const said = JSON.stringify(body?.errors ?? "").toLowerCase();
      return { failed: /timeout|timed out/.test(said) ? "timeout" : res.ok || res.status === 422 || res.status === 400 ? "refused" : "error" };
    }
    return { html: html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html, ms: Date.now() - started };
  } catch (e) {
    return { failed: e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "error" };
  }
}
