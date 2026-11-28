// Offline tests for running a page in a browser (api/_render.js) and for what Page Reader does with the result
// (withRendering in api/page.js). Cloudflare is stubbed: nothing is fetched.
// Run from official-apis/tools: node --test test/

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { renderPage, renderReady, resetRenderCount } from "../api/_render.js";
import { readable, withRendering } from "../api/page.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const answer = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  process.env.CLOUDFLARE_BROWSER_TOKEN = "test-token";
  delete process.env.CLOUDFLARE_API_KEY;
  delete process.env.PAGE_RENDER_DAILY_MAX;
  resetRenderCount();
});

// ---------------------------------------------------------------- the browser

test("a page is sent to the account's browser with the token, and its finished HTML comes back", async () => {
  let seen;
  const out = await renderPage("https://demo.xyz/app", {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return answer(200, { success: true, result: "<html><body>done</body></html>", meta: {} });
    },
  });
  assert.equal(out.html, "<html><body>done</body></html>");
  assert.equal(typeof out.ms, "number");
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-run/content`);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, "Bearer test-token");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.url, "https://demo.xyz/app");
  assert.equal(body.gotoOptions.waitUntil, "networkidle2");
  assert.ok(body.gotoOptions.timeout < 14_000, "the page gets less time than the request, so the answer still arrives");
  assert.deepEqual(body.rejectResourceTypes, ["image", "media", "font"]);
  assert.deepEqual(Object.keys(body).sort(), ["gotoOptions", "rejectResourceTypes", "url"], "nothing about the caller is sent");
});

test("without an account or a token nothing is rendered and nothing is sent", async () => {
  const never = async () => assert.fail("no request should be made");
  delete process.env.CLOUDFLARE_BROWSER_TOKEN;
  assert.equal(renderReady(), false);
  assert.deepEqual(await renderPage("https://demo.xyz/", { fetchImpl: never }), { failed: "not_set_up" });
  process.env.CLOUDFLARE_API_KEY = "other-name";
  assert.equal(renderReady(), true, "the token is read under either name");
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  assert.deepEqual(await renderPage("https://demo.xyz/", { fetchImpl: never }), { failed: "not_set_up" });
});

test("every way it can go wrong comes back as a word, never an exception", async () => {
  const failed = async (fetchImpl, options = {}) => (await renderPage("https://demo.xyz/", { fetchImpl, ...options })).failed;
  assert.equal(await failed(async () => answer(429, { success: false, errors: [{ code: 2001, message: "Rate limit exceeded" }] })), "busy");
  assert.equal(await failed(async () => answer(200, { success: false, errors: [{ message: "Navigation timeout of 12000 ms exceeded" }] })), "timeout");
  assert.equal(await failed(async () => answer(422, { success: false, errors: [{ message: "net::ERR_NAME_NOT_RESOLVED" }] })), "refused");
  assert.equal(await failed(async () => answer(200, { success: true, result: "" })), "refused", "an empty page is not a page");
  assert.equal(await failed(async () => answer(403, { success: false, errors: [{ message: "Authentication error" }] })), "error");
  assert.equal(await failed(async () => ({ status: 502, ok: false, json: async () => { throw new Error("not json"); } })), "error");
  assert.equal(await failed(async () => { throw new Error("socket hang up"); }), "error");
  assert.equal(await failed(async () => { throw Object.assign(new Error("took too long"), { name: "TimeoutError" }); }), "timeout");
  assert.equal(await failed(async () => assert.fail("too little time left to try"), { timeoutMs: 3_000 }), "timeout");
});

test("the day's limit stops further pages, and a new day starts again", async () => {
  process.env.PAGE_RENDER_DAILY_MAX = "2";
  let calls = 0;
  const ok = async () => (calls++, answer(200, { success: true, result: "<p>x</p>" }));
  assert.ok((await renderPage("https://a.xyz/", { fetchImpl: ok })).html);
  assert.ok((await renderPage("https://b.xyz/", { fetchImpl: ok })).html);
  assert.deepEqual(await renderPage("https://c.xyz/", { fetchImpl: ok }), { failed: "daily_limit" });
  assert.equal(calls, 2);
  resetRenderCount();
  assert.ok((await renderPage("https://d.xyz/", { fetchImpl: ok })).html);
});

test("a very large page is cut, not refused", async () => {
  const out = await renderPage("https://big.xyz/", { fetchImpl: async () => answer(200, { success: true, result: "a".repeat(2_500_000) }) });
  assert.equal(out.html.length, 2_000_000);
});

// ---------------------------------------------------------------- what Page Reader does with it

const TOKEN = "0xE83C85E1eaD16FCFe85401E2b337Fb4FB5B5cC96";
const filler = "The project gives creators a way to sell access to an API and get paid for every single call. ".repeat(3);
const shell = `<html><head><title>App</title></head><body><div id="root"></div><script src="/a.js"></script></body></html>`;
const finished = `<html><head><title>App</title></head><body><div id="root"><main><h1>Demo</h1><p>${filler}</p><p>Contract: ${TOKEN}</p><a href="https://x.com/demo">X</a></main></div><script src="/a.js"></script></body></html>`;
const first = () => readable(shell, { url: "https://demo.xyz/", expect: TOKEN.toLowerCase() });

test("a page built in the browser is answered from its finished form, and says so", () => {
  const before = first();
  assert.equal(before.rendering.needsJavaScript, true);
  assert.equal(before.rendering.rendered, false);
  assert.equal(before.rendering.renderNote, null);
  const out = withRendering(before, readable(finished, { url: "https://demo.xyz/", expect: TOKEN.toLowerCase() }), { ms: 5200 });
  assert.match(out.text, /sell access to an API/);
  assert.equal(out.rendering.rendered, true);
  assert.equal(out.rendering.needsJavaScript, true, "it still says the page needs scripts: that is a fact about the page");
  assert.equal(out.rendering.renderMs, 5200);
  assert.equal(out.rendering.renderNote, null);
  assert.equal(out.rendering.readableWordsBefore, 0);
  assert.deepEqual(out.links.accounts.x, ["https://x.com/demo"]);
  assert.equal(out.expected.found, true);
  assert.deepEqual(out.flags.map((f) => f.code), ["rendered_in_browser", "expected_address_shown"]);
  assert.equal(out.flags[0].severity, "info");
  assert.equal(out.flags.some((f) => f.code === "needs_javascript"), false);
});

test("when the browser gives nothing, the first reading stands and says why", () => {
  for (const [why, said] of [["not_set_up", /No browser is set up/], ["busy", /browser was busy/], ["timeout", /didn't finish loading/], ["turned_off", /turned off/], ["daily_limit", /day's limit/], ["refused", /couldn't load the page/], ["error", /couldn't be reached/]]) {
    const out = withRendering(first(), null, { why });
    assert.equal(out.rendering.rendered, false, why);
    assert.equal(out.rendering.renderNote, why);
    assert.equal(out.rendering.renderMs, null);
    assert.equal(out.words, 0);
    const flag = out.flags.find((f) => f.code === "needs_javascript");
    assert.equal(flag.severity, "warn");
    assert.match(flag.text, said, why);
    assert.equal(out.expected.found, false);
  }
  assert.equal(withRendering(first(), null, {}).rendering.renderNote, "error", "an unknown failure is still a failure");
});

test("a browser check or an empty finished page never replaces the first reading", () => {
  const wall = `<html><body><div id="root"></div><script src="/c.js"></script><script src="/d.js"></script><script src="/e.js"></script></body></html>`;
  const out = withRendering(first(), readable(wall, { url: "https://demo.xyz/" }), { ms: 3000 });
  assert.equal(out.rendering.rendered, false);
  assert.equal(out.rendering.renderNote, "no_more_text");
  assert.equal(out.rendering.renderMs, 3000);
  assert.match(out.flags.find((f) => f.code === "needs_javascript").text, /may turn automated browsers away/);
});

test("a page that never needed scripts is marked as such and left alone", () => {
  const r = readable(`<html><body><main><p>${filler}</p></main></body></html>`);
  assert.deepEqual([r.rendering.needsJavaScript, r.rendering.rendered, r.rendering.renderNote], [false, false, "not_needed"]);
});
