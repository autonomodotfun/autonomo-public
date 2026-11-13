// Safe outbound requests for the tools that fetch addresses a caller chose (files starting with "_" aren't routes).
// https only, no credentials in the URL, and every hop must resolve to a public address, so a caller can't point
// these tools at the server's own network.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]]) {
  blocked.addSubnet(net, bits, "ipv4");
}
// (No ::ffff:0:0/96 rule: Node's BlockList would then match every IPv4 address. IPv4-mapped IPv6 is unwrapped below.)
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]]) blocked.addSubnet(net, bits, "ipv6");

export function isBlocked(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  return blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

/** The public addresses a host resolves to, or an error when it has none or any of them is private. */
export async function publicAddresses(hostname) {
  try {
    const addrs = await lookup(hostname, { all: true, verbatim: true });
    if (!addrs.length || addrs.some((a) => isBlocked(a.address))) return { error: "That host isn't a public address." };
    return { addresses: addrs };
  } catch {
    return { error: "That host doesn't resolve.", unresolved: true };
  }
}

/** A URL that is safe to fetch: { url } or { error }. */
export async function publicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "Pass a full URL, like https://example.com/page" };
  }
  if (url.protocol !== "https:") return { error: "Only https URLs are supported." };
  if (url.username || url.password) return { error: "URLs with credentials aren't allowed." };
  const found = await publicAddresses(url.hostname);
  return found.error ? { error: found.error, unresolved: found.unresolved } : { url };
}

/** One request that is never followed anywhere: status, headers, time taken and the start of the body.
 * Returns { error } for an address that isn't allowed, { failed } when the request itself didn't get an answer. */
export async function fetchOnce(raw, { method = "GET", headers = {}, body, timeoutMs = 10_000, maxBytes = 200_000 } = {}) {
  const check = await publicUrl(raw);
  if (check.error) return { error: check.error, unresolved: check.unresolved };
  const started = Date.now();
  let res;
  try {
    res = await fetch(check.url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { failed: e?.name === "TimeoutError" ? `No answer within ${timeoutMs / 1000} seconds` : "The connection failed", ms: Date.now() - started };
  }
  const ms = Date.now() - started;
  const chunks = [];
  let size = 0;
  try {
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > maxBytes) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // a body cut short still leaves the status and headers
  }
  return { status: res.status, headers: res.headers, ms, text: Buffer.concat(chunks).toString("utf8").slice(0, maxBytes), url: check.url };
}
