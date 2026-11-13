// Official Autonomo API: a trust check for a website, before an agent or a person relies on it.
//
// GET /v1/site?url=https://example.com   (a bare domain works too; header: x-api-key: <TOOLS_API_KEY>)
//
// Four things, read live from public sources:
//   1. The domain: when it was registered, when it expires and with which registrar (RDAP, the registries' own
//      data, found through IANA's list of registries).
//   2. The certificate: who issued it, whether it is valid for this host, and how long it has left.
//   3. The site: whether it answers over https, and where it ends up after redirects.
//   4. The name: whether it looks like a well-known name on a domain that isn't that company's.
//
// It then lists what stands out and gives a caution level. A new domain or a similar name is a reason to look
// closer, never proof of anything, and an old domain with a good certificate can still be a bad site.

import { resolveMx } from "node:dns/promises";
import tls from "node:tls";
import { authorized, sendJson } from "./_lib.js";
import { fetchOnce, publicAddresses } from "./_net.js";

const DAY = 86_400_000;
const cache = new Map(); // host -> { at, status, body }
const CACHE_MS = 10 * 60_000;

// Well-known names and the domains that really belong to them. `distinct` names are unusual enough that finding one
// inside a longer name ("coinbase-login") means something; common words like "apple" are only matched closely.
const BRANDS = [
  { name: "autonomo", domains: ["autonomo.fun"], distinct: false },
  { name: "robinhood", domains: ["robinhood.com"], distinct: true },
  { name: "coinbase", domains: ["coinbase.com"], distinct: true },
  { name: "metamask", domains: ["metamask.io", "metamask.com"], distinct: true },
  { name: "uniswap", domains: ["uniswap.org"], distinct: true },
  { name: "binance", domains: ["binance.com", "binance.us"], distinct: true },
  { name: "opensea", domains: ["opensea.io"], distinct: true },
  { name: "trezor", domains: ["trezor.io"], distinct: true },
  { name: "paypal", domains: ["paypal.com"], distinct: true },
  { name: "blockscout", domains: ["blockscout.com"], distinct: true },
  { name: "etherscan", domains: ["etherscan.io"], distinct: true },
  { name: "polymarket", domains: ["polymarket.com"], distinct: true },
  { name: "pancakeswap", domains: ["pancakeswap.finance"], distinct: true },
  { name: "phantom", domains: ["phantom.com", "phantom.app"], distinct: false },
  { name: "ledger", domains: ["ledger.com"], distinct: false },
  { name: "kraken", domains: ["kraken.com"], distinct: false },
  { name: "google", domains: ["google.com"], distinct: false },
  { name: "microsoft", domains: ["microsoft.com"], distinct: false },
  { name: "amazon", domains: ["amazon.com"], distinct: false },
  { name: "telegram", domains: ["telegram.org", "t.me"], distinct: false },
  { name: "discord", domains: ["discord.com", "discord.gg"], distinct: false },
];
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** The part of a host someone registered ("shop.example.co.uk" -> "example.co.uk"). A simple rule, not the full
 * public-suffix list, so a few unusual endings come out one label short. */
export function registrable(host) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const twoPart = labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2));
  return labels.slice(twoPart ? -3 : -2).join(".");
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** A well-known name this domain resembles without being one of its real domains, or null. */
export function lookalike(domain) {
  const label = domain.split(".")[0];
  if (label.startsWith("xn--")) return { brand: null, why: "The name uses special characters that can imitate ordinary letters" };
  // Digits often stand in for letters: 0 for o, 1 for l or i, 3 for e, 5 for s.
  const plain = label.replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/-/g, "");
  for (const b of BRANDS) {
    if (b.domains.includes(domain)) return null;
    const official = b.domains[0];
    if (label === b.name) return { brand: b.name, why: `It uses the name "${b.name}" on a different ending than the official ${official}` };
    if (plain === b.name) return { brand: b.name, why: `It spells "${b.name}" with swapped characters. The official site is ${official}` };
    if (b.name.length >= 6 && distance(plain, b.name) === 1) return { brand: b.name, why: `It is one letter away from "${b.name}". The official site is ${official}` };
    if (b.distinct && plain.includes(b.name)) return { brand: b.name, why: `It contains the name "${b.name}" but isn't the official ${official}` };
  }
  return null;
}

const RDAP_HEADERS = { accept: "application/rdap+json, application/json", "user-agent": "AutonomoWebsiteCheck/1.0 (+https://autonomo.fun)" };
let registries = null; // { at, byTld }: IANA's list of which registry answers for each ending, reread once a day

/** The registry's RDAP address for a domain's ending, from IANA's published list, or null when it has none. */
async function registryFor(domain) {
  if (!registries || Date.now() - registries.at > DAY) {
    const r = await fetchOnce("https://data.iana.org/rdap/dns.json", { headers: RDAP_HEADERS, timeoutMs: 7_000, maxBytes: 2_000_000 });
    if (r.status !== 200) return null;
    const byTld = new Map();
    for (const [tlds, urls] of JSON.parse(r.text).services ?? []) for (const t of tlds) byTld.set(t.toLowerCase(), urls.find((u) => u.startsWith("https://")) ?? null);
    registries = { at: Date.now(), byTld };
  }
  return registries.byTld.get(domain.split(".").at(-1)) ?? null;
}

/** Registration data from RDAP, the registries' own records. Each hop is checked like any other address. */
async function domainRecord(domain) {
  const registry = await registryFor(domain);
  if (!registry) return null;
  let url = `${registry.replace(/\/?$/, "/")}domain/${encodeURIComponent(domain)}`;
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetchOnce(url, { headers: RDAP_HEADERS, timeoutMs: 7_000, maxBytes: 300_000 });
    if (r.error || r.failed) return null;
    const next = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && next) {
      url = new URL(next, r.url).href;
      continue;
    }
    if (r.status !== 200) return null;
    let data;
    try {
      data = JSON.parse(r.text);
    } catch {
      return null;
    }
    const when = (action) => data.events?.find((e) => e.eventAction === action)?.eventDate ?? null;
    const registrar = data.entities?.find((e) => e.roles?.includes("registrar"));
    const name = registrar?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3] ?? null;
    return { registered: when("registration"), expires: when("expiration"), changed: when("last changed"), registrar: name ? String(name).slice(0, 100) : null };
  }
  return null;
}

/** The certificate the host presents, read from one of its public addresses. */
function certificate(host, address) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: address, port: 443, servername: host, rejectUnauthorized: false, timeout: 7_000 }, () => {
      const cert = socket.getPeerCertificate();
      const result = cert?.valid_to
        ? {
            valid: socket.authorized,
            problem: socket.authorized ? null : String(socket.authorizationError ?? "not trusted"),
            issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
            validFrom: new Date(cert.valid_from).toISOString(),
            validTo: new Date(cert.valid_to).toISOString(),
          }
        : null;
      socket.end();
      resolve(result);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

/** Where the site ends up over https, following up to four redirects, each checked to be a public address. */
async function visit(start) {
  let url = start;
  const hops = [];
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetchOnce(url, { headers: { accept: "text/html,*/*;q=0.5", "user-agent": "AutonomoWebsiteCheck/1.0 (+https://autonomo.fun)" }, timeoutMs: 8_000, maxBytes: 150_000 });
    if (r.error || r.failed) return { answered: hops.length > 0, status: null, finalUrl: url, hops, problem: r.error ?? r.failed };
    const next = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && next && hop < 4) {
      hops.push(url);
      url = new URL(next, r.url).href;
      continue;
    }
    const title = r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 200) || null;
    return { answered: true, status: r.status, finalUrl: r.url.href, hops, title, ms: r.ms };
  }
  return { answered: true, status: null, finalUrl: url, hops, problem: "Too many redirects" };
}

async function check(host) {
  const found = await publicAddresses(host);
  const domain = registrable(host);
  if (found.error) {
    const unresolved = found.unresolved;
    return unresolved
      ? { status: 200, body: { host, domain, caution: "high", summary: "This host doesn't exist: nothing answers at that name.", flags: [{ severity: "warn", text: "The host doesn't resolve to any address" }], checkedAt: new Date().toISOString() } }
      : { status: 400, body: { error: "bad_url", message: found.error } };
  }

  const [record, cert, site, mail] = await Promise.all([
    domainRecord(domain).catch(() => null),
    certificate(host, found.addresses[0].address).catch(() => null),
    visit(`https://${host}/`).catch(() => null),
    resolveMx(domain).then((list) => list.length > 0).catch(() => false),
  ]);

  const now = Date.now();
  const days = (iso) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : null);
  const ageDays = days(record?.registered);
  const expiresInDays = record?.expires ? -days(record.expires) : null;
  const certDaysLeft = cert ? -days(cert.validTo) : null;
  const finalHost = site?.finalUrl ? new URL(site.finalUrl).hostname : null;
  const movedTo = finalHost && registrable(finalHost) !== domain ? registrable(finalHost) : null;
  const similar = lookalike(domain);

  const flags = [];
  const flag = (severity, text) => flags.push({ severity, text });
  if (similar) flag("warn", `${similar.why}: it may be imitating it`);
  if (ageDays !== null && ageDays < 30) flag("warn", `The domain was registered ${ageDays} day${ageDays === 1 ? "" : "s"} ago`);
  else if (ageDays !== null && ageDays < 180) flag("info", `The domain is ${ageDays} days old`);
  else if (ageDays !== null) flag("good", `The domain has been registered for ${ageDays >= 730 ? `${Math.floor(ageDays / 365)} years` : `${ageDays} days`}`);
  else flag("info", "The registry doesn't publish when this domain was registered");
  if (expiresInDays !== null && expiresInDays < 30) flag("info", `The domain registration ends in ${expiresInDays} days`);
  if (!cert) flag("warn", "No https certificate could be read from this host");
  else if (!cert.valid) flag("warn", `The certificate isn't valid for this host (${cert.problem})`);
  else if (certDaysLeft < 14) flag("info", `The certificate expires in ${certDaysLeft} days`);
  else flag("good", `Valid certificate from ${cert.issuer ?? "its issuer"}`);
  if (!site?.answered) flag("warn", "The site doesn't answer over https");
  else if (site.status >= 400) flag("info", `The site answers with an error (${site.status})`);
  if (movedTo) flag("info", `It redirects to a different domain: ${movedTo}`);

  const warns = flags.filter((f) => f.severity === "warn").length;
  const caution = warns >= 2 ? "high" : warns === 1 ? "medium" : "low";
  const first = flags.find((f) => f.severity === "warn") ?? flags.find((f) => f.severity === "info");
  const summary =
    caution === "low"
      ? `Nothing stands out about ${domain}${ageDays !== null ? `, registered ${ageDays >= 730 ? `${Math.floor(ageDays / 365)} years` : `${ageDays} days`} ago` : ""}.`
      : `${caution === "high" ? "Be careful with" : "Look closer at"} ${domain}: ${first.text.charAt(0).toLowerCase()}${first.text.slice(1)}${warns > 1 ? `, and ${warns - 1} more warning${warns > 2 ? "s" : ""}` : ""}.`;

  return {
    status: 200,
    body: {
      host,
      domain,
      caution,
      summary,
      flags,
      registration: record ? { ...record, ageDays, expiresInDays } : null,
      certificate: cert ? { ...cert, daysLeft: certDaysLeft } : null,
      site: site ? { answers: site.answered, httpStatus: site.status ?? null, finalUrl: site.finalUrl, redirects: site.hops.length, movedToDomain: movedTo, title: site.title ?? null } : null,
      similarTo: similar?.brand ?? null,
      receivesEmail: mail,
      note: "Read live from public registry, certificate and site data. A new domain or a similar name is a reason to look closer, not proof; an old domain with a valid certificate can still be a bad site.",
      checkedAt: new Date().toISOString(),
    },
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  const raw = String(req.query.url ?? req.query.domain ?? "").trim();
  if (!raw || raw.length > 2000) return sendJson(res, 400, { error: "bad_url", message: "Pass a website: /v1/site?url=https://example.com" });
  let host;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.username || url.password) throw new Error("credentials");
    host = url.hostname.toLowerCase();
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) throw new Error("not a domain");
  } catch {
    return sendJson(res, 400, { error: "bad_url", message: "Pass a website by its name, like example.com or https://example.com/page." });
  }
  try {
    const hit = cache.get(host);
    if (hit && Date.now() - hit.at < CACHE_MS) return sendJson(res, hit.status, hit.body);
    const result = await check(host);
    if (cache.size > 2000) cache.clear();
    cache.set(host, { at: Date.now(), ...result });
    return sendJson(res, result.status, result.body);
  } catch (e) {
    console.error(e.message);
    return sendJson(res, 502, { error: "check_failed", message: "Couldn't run the check right now. Try again." });
  }
}
