"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { checkUpstream, encryptSecret, ownerPayTo, RESERVED_SLUGS, secretsEnabled, testUpstream } from "@/lib/gateway";
import { autonomoAmountValid, headerNameValid, slugError, testVerdict, usdPriceValid } from "@/lib/gateway-rules";
import { revalidateCatalog } from "@/lib/queries";
import { currentOwner } from "@/lib/session";

const { gateways } = schema;

// "Launch several at once": APIs that live at one address and share one key, launched together. Every API goes
// through the same rules and the same test call as the one-at-a-time form. It is all or nothing: if one API has a
// problem, none is launched, so a list never ends up half done.

const MAX_APIS = 20;
const CHECKS_PER_MINUTE = 6;
const TESTS_AT_ONCE = 4;
const recentChecks = new Map<string, number[]>();

export type BulkShared = { upstreamUrl: string; authHeader: string; authSecret: string };
export type BulkApi = { name: string; slug: string; description: string; priceUsd: string; autonomoAmount: string; path: string };
export type BulkApiResult = { slug: string; problems: string[]; test: { pass: boolean; text: string } | null };
export type BulkResult = {
  // A problem with the shared fields or the list itself, shown above the list.
  error?: string;
  apis: BulkApiResult[];
  // Set by launchMany when everything passed and the APIs now exist.
  launched?: boolean;
  listingAsked?: boolean;
};

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function clean(shared: BulkShared, apis: BulkApi[]) {
  return {
    shared: {
      upstreamUrl: text(shared?.upstreamUrl, 500),
      authHeader: text(shared?.authHeader, 64),
      authSecret: String(shared?.authSecret ?? "").slice(0, 2000),
    },
    apis: (Array.isArray(apis) ? apis : []).slice(0, MAX_APIS + 1).map((a) => ({
      name: text(a?.name, 80),
      slug: text(a?.slug, 40).toLowerCase(),
      description: text(a?.description, 300),
      priceUsd: text(a?.priceUsd, 20),
      autonomoAmount: text(a?.autonomoAmount, 30),
      path: String(a?.path ?? "").slice(0, 500),
    })),
  };
}

/** Checks the shared fields and every API, then makes one test call per API that has no problem of its own. */
async function inspect(owner: string, rawShared: BulkShared, rawApis: BulkApi[]) {
  const { shared, apis } = clean(rawShared, rawApis);
  const fail = (error: string) => ({ error, apis: [] as BulkApiResult[], shared, list: apis, upstream: null });
  if (!apis.length) return fail("Add at least one API.");
  if (apis.length > MAX_APIS) return fail(`That's more than ${MAX_APIS} APIs. Launch them in two goes.`);

  const now = Date.now();
  const recent = (recentChecks.get(owner) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= CHECKS_PER_MINUTE) return fail("That's a lot of checks. Wait a minute and try again.");
  recentChecks.set(owner, [...recent, now]);

  const upstream = await checkUpstream(shared.upstreamUrl);
  if (!upstream.ok) return fail(`Your API's address: ${upstream.error}`);
  if (shared.authHeader && !headerNameValid(shared.authHeader)) return fail("Use a plain header name for your key, like Authorization or X-API-Key.");
  if (shared.authSecret && !shared.authHeader) return fail("Say which header your API reads the key from.");
  if (shared.authSecret && !secretsEnabled()) return fail("Saving an API key isn't enabled on this deployment.");

  const db = await getDb();
  const wanted = apis.map((a) => a.slug).filter(Boolean);
  const taken = new Set(
    wanted.length ? (await db.select({ slug: gateways.slug }).from(gateways).where(inArray(gateways.slug, wanted))).map((r) => r.slug) : [],
  );
  const results: BulkApiResult[] = apis.map((a, i) => {
    const problems: string[] = [];
    if (!a.name) problems.push("Give it a name.");
    const slug = slugError(a.slug, RESERVED_SLUGS);
    if (slug) problems.push(`Paid address: ${slug}`);
    else if (taken.has(a.slug)) problems.push("That paid address is taken.");
    else if (apis.findIndex((b) => b.slug === a.slug) !== i) problems.push("Another API in this list has the same paid address.");
    if (!a.priceUsd && !a.autonomoAmount) problems.push("Set a price in USDG, in $AUTONOMO, or both.");
    if (a.priceUsd && !usdPriceValid(a.priceUsd)) problems.push("USDG price: between 0.000001 and 100, up to 6 decimals.");
    if (a.autonomoAmount && !autonomoAmountValid(a.autonomoAmount)) problems.push("$AUTONOMO price: a number above zero.");
    return { slug: a.slug, problems, test: null };
  });

  // One free test call each, a few at a time, the way a paid call would reach the API.
  const auth = shared.authHeader && shared.authSecret ? { header: shared.authHeader, secret: shared.authSecret } : undefined;
  const queue = results.map((r, i) => ({ r, api: apis[i] })).filter(({ r }) => r.problems.length === 0);
  await Promise.all(
    Array.from({ length: TESTS_AT_ONCE }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        job.r.test = testVerdict(await testUpstream(shared.upstreamUrl, job.api.path, auth));
        if (!job.r.test.pass) job.r.problems.push(`Test call: ${job.r.test.text}`);
      }
    }),
  );
  return { error: undefined, apis: results, shared, list: apis, upstream };
}

/** "Check all": the rules and a test call for every API in the list. Launches nothing. */
export async function checkMany(shared: BulkShared, apis: BulkApi[]): Promise<BulkResult> {
  const owner = await currentOwner();
  if (!owner) return { error: "Sign in first.", apis: [] };
  const { error, apis: results } = await inspect(owner, shared, apis);
  return { error, apis: results };
}

/** Launches every API in the list, after checking them all again. Nothing is launched unless all of them pass. */
export async function launchMany(shared: BulkShared, apis: BulkApi[], askListing: boolean): Promise<BulkResult> {
  const owner = await currentOwner();
  if (!owner) return { error: "Sign in first.", apis: [] };
  const checked = await inspect(owner, shared, apis);
  if (checked.error || !checked.upstream?.ok) return { error: checked.error, apis: checked.apis };
  if (checked.apis.some((a) => a.problems.length)) {
    return { error: "Nothing was launched. Fix the APIs marked below, then try again.", apis: checked.apis };
  }

  const db = await getDb();
  const payTo = await ownerPayTo(owner);
  const upstreamUrl = checked.upstream.url.href.replace(/\/+$/, "");
  const secret = checked.shared.authSecret ? encryptSecret(checked.shared.authSecret) : null;
  try {
    await db.insert(gateways).values(
      checked.list.map((a) => ({
        slug: a.slug,
        name: a.name,
        description: a.description,
        upstreamUrl,
        upstreamAuthHeader: checked.shared.authHeader || null,
        upstreamAuthSecret: checked.shared.authHeader ? secret : null,
        priceUsd: a.priceUsd || "0",
        acceptUsdg: Boolean(a.priceUsd),
        autonomoAmount: a.autonomoAmount || null,
        owner,
        payTo,
        ...(askListing ? { listing: "pending" as const } : {}),
        updatedAt: new Date(),
      })),
    );
  } catch (e) {
    // Most likely someone took one of the paid addresses between the check and the launch.
    console.error("bulk launch failed", e);
    return { error: "Nothing was launched: one of the paid addresses was taken just now. Check all again.", apis: checked.apis };
  }
  revalidatePath("/dashboard");
  revalidateCatalog();
  return { apis: checked.apis, launched: true, listingAsked: askListing };
}
