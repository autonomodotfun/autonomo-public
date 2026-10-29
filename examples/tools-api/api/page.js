// GET /v1/page?url=https://example.com/article  (header: x-api-key)
// Fetches a public web page and returns its title, description and readable text, ready for an AI agent.
//
// Safety: https only, no credentials in the URL, every hop (including redirects) must resolve to a public
// address, at most 3 redirects, 2 MB, 10 s, and only HTML or plain-text responses.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { authorized, sendJson } from "./_lib.js";

const MAX_BYTES = 2_000_000;
const MAX_CHARS = 20_000;
const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]]) {
  blocked.addSubnet(net, bits, "ipv4");
}
// (No ::ffff:0:0/96 rule: Node's BlockList would then match every IPv4 address. IPv4-mapped IPv6 is unwrapped below.)
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]]) blocked.addSubnet(net, bits, "ipv6");

function isBlocked(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  return blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

async function publicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "Pass a full URL, like https://example.com/page" };
  }
  if (url.protocol !== "https:") return { error: "Only https URLs are supported." };
  if (url.username || url.password) return { error: "URLs with credentials aren't allowed." };
  try {
    const addrs = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addrs.length || addrs.some((a) => isBlocked(a.address))) {
      return { error: "That host isn't a public address." };
    }
  } catch {
    return { error: "That host doesn't resolve." };
  }
  return { url };
}

async function fetchPage(raw) {
  let target = raw;
  for (let hop = 0; hop <= 3; hop++) {
    const check = await publicUrl(target);
    if (check.error) return { status: 400, error: check.error };
    const res = await fetch(check.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "AutonomoPageReader/1.0 (+https://autonomo.fun)", accept: "text/html,text/plain;q=0.9" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      target = new URL(res.headers.get("location"), check.url).href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { status: 502, error: `The page answered ${res.status}.` };
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      await res.body?.cancel();
      return { status: 415, error: `Only HTML or plain-text pages are supported (got ${type || "unknown type"}).` };
    }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { finalUrl: check.url.href, type, body: Buffer.concat(chunks).toString("utf8") };
  }
  return { status: 400, error: "Too many redirects." };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

function readable(html) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "") || null;
  const description =
    decode(
      html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
        html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1] ??
        "",
    ).trim() || null;
  // Prefer <article> or <main> when the page has one.
  const main = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const text = decode(
    main
      .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre|header)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, description, text };
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const raw = String(req.query.url ?? "").trim();
  if (!raw) return sendJson(res, 400, { error: "bad_url", message: "Pass a page: /v1/page?url=https://…" });
  try {
    const page = await fetchPage(raw);
    if (page.error) return sendJson(res, page.status, { error: "page_error", message: page.error });
    const out = page.type.includes("text/plain") ? { title: null, description: null, text: page.body.trim() } : readable(page.body);
    const truncated = out.text.length > MAX_CHARS;
    return sendJson(res, 200, {
      url: page.finalUrl,
      title: out.title,
      description: out.description,
      text: truncated ? `${out.text.slice(0, MAX_CHARS)}…` : out.text,
      words: out.text.split(/\s+/).filter(Boolean).length,
      truncated,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return sendJson(res, 504, { error: "page_error", message: timeout ? "The page took too long to load." : "Couldn't load that page." });
  }
}
