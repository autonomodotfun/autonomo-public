"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAddress, isHex, verifyMessage, type Hex } from "viem";
import { getDb, schema } from "@/db";
import { checkUpstream, encryptSecret, RESERVED_SLUGS, secretsEnabled, ownerPayTo, testUpstream, type UpstreamTest } from "@/lib/gateway";
import { applyPayTo, firstSafeMessage } from "@/lib/pay-to";
import { currentOwner, seal, unseal } from "@/lib/session";
import { revalidateCatalog } from "@/lib/queries";
import { safeInfo } from "@/lib/verified";

const { gateways, payToRequests } = schema;

// How long the message to set a first Safe stays valid for signing.
const SAFE_SIGN_TTL_S = 10 * 60;

export type GatewayFormState = {
  ok: boolean;
  errors?: Partial<Record<string, string>>;
  values?: Record<string, string>;
};

const FORBIDDEN_HEADERS = new Set(["host", "content-length", "cookie", "connection", "transfer-encoding", "payment-signature"]);

async function requireOwner() {
  const owner = await currentOwner();
  if (!owner) throw new Error("Not signed in");
  return owner;
}

function str(form: FormData, k: string, max = 500) {
  return String(form.get(k) ?? "").trim().slice(0, max);
}

/**
 * Step 1 of the launch form, checked before the creator moves on: the paid address is free and the API's address can
 * be reached. saveGateway checks both again on launch.
 */
export async function checkLaunchStep(slug: string, upstreamUrl: string): Promise<{ slug?: string; upstreamUrl?: string }> {
  await requireOwner();
  const errors: { slug?: string; upstreamUrl?: string } = {};
  const wanted = String(slug).trim().toLowerCase().slice(0, 40);
  if (RESERVED_SLUGS.has(wanted)) {
    errors.slug = "That name is reserved.";
  } else {
    const db = await getDb();
    const [taken] = await db.select({ id: gateways.id }).from(gateways).where(eq(gateways.slug, wanted)).limit(1);
    if (taken) errors.slug = "That paid address is taken.";
  }
  const upstream = await checkUpstream(String(upstreamUrl).trim().slice(0, 500));
  if (!upstream.ok) errors.upstreamUrl = upstream.error;
  return errors;
}

// Test calls per signed-in owner. Kept in memory: it only has to stop one browser hammering the button.
const TESTS_PER_MINUTE = 10;
const recentTests = new Map<string, number[]>();

/** "Test my API" on the launch form: one free GET to the creator's API, with their key if they typed one. */
export async function testApi(input: { upstreamUrl: string; path: string; authHeader: string; authSecret: string }): Promise<UpstreamTest> {
  const owner = await requireOwner();
  const now = Date.now();
  const recent = (recentTests.get(owner) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= TESTS_PER_MINUTE) return { ok: false, error: "That's a lot of tests. Wait a minute and try again." };
  recentTests.set(owner, [...recent, now]);

  const header = String(input.authHeader ?? "").trim().slice(0, 64);
  const secret = String(input.authSecret ?? "").slice(0, 2000);
  if (header && (!/^[A-Za-z0-9-]{1,64}$/.test(header) || FORBIDDEN_HEADERS.has(header.toLowerCase()))) {
    return { ok: false, error: "Use a plain header name for your key, like Authorization or X-API-Key." };
  }
  return testUpstream(
    String(input.upstreamUrl ?? "").trim().slice(0, 500),
    String(input.path ?? "").slice(0, 500),
    header && secret ? { header, secret } : undefined,
  );
}

/** Creates a gateway, or updates one when the form carries an id. */
export async function saveGateway(_prev: GatewayFormState, form: FormData): Promise<GatewayFormState> {
  const owner = await requireOwner();
  const id = Number(form.get("id")) || null;
  const values = {
    name: str(form, "name", 80),
    slug: str(form, "slug", 40).toLowerCase(),
    description: str(form, "description", 300),
    upstreamUrl: str(form, "upstreamUrl", 500),
    authHeader: str(form, "authHeader", 64),
    priceUsd: str(form, "priceUsd", 20),
    autonomoAmount: str(form, "autonomoAmount", 30),
    acceptUsdg: form.get("acceptUsdg") === "on" ? "on" : "",
    acceptAutonomo: form.get("acceptAutonomo") === "on" ? "on" : "",
  };
  const secret = String(form.get("authSecret") ?? "").slice(0, 2000);
  const clearSecret = form.get("clearSecret") === "on";
  const errors: Record<string, string> = {};

  if (!values.name) errors.name = "Give your API a name.";
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(values.slug)) {
    errors.slug = "3–40 lowercase letters, numbers or dashes.";
  } else if (RESERVED_SLUGS.has(values.slug)) {
    errors.slug = "That name is reserved.";
  }
  const upstream = await checkUpstream(values.upstreamUrl);
  if (!upstream.ok) errors.upstreamUrl = upstream.error;

  const acceptUsdg = values.acceptUsdg === "on";
  const acceptAutonomo = values.acceptAutonomo === "on";
  const price = Number(values.priceUsd);
  const priceValid = /^\d+(\.\d{1,6})?$/.test(values.priceUsd) && price > 0 && price <= 100;
  if (acceptUsdg && !priceValid) errors.priceUsd = "A USD price between 0.000001 and 100, up to 6 decimals.";
  if (acceptAutonomo && (!/^\d+(\.\d{1,18})?$/.test(values.autonomoAmount) || !(Number(values.autonomoAmount) > 0))) {
    errors.autonomoAmount = "How many $AUTONOMO per call.";
  }
  if (!acceptUsdg && !acceptAutonomo) errors.acceptUsdg = "Accept at least one payment option.";

  if (values.authHeader && (!/^[A-Za-z0-9-]{1,64}$/.test(values.authHeader) || FORBIDDEN_HEADERS.has(values.authHeader.toLowerCase()))) {
    errors.authHeader = "Use a plain header name, like Authorization or X-API-Key.";
  }
  if (secret && !values.authHeader) errors.authHeader = "Say which header your API reads the key from.";
  if (secret && !secretsEnabled()) errors.authSecret = "Saving an API key isn't enabled on this deployment.";

  const db = await getDb();
  const existing = id
    ? (await db.select().from(gateways).where(and(eq(gateways.id, id), eq(gateways.owner, owner))).limit(1))[0]
    : null;
  if (id && !existing) throw new Error("Not found");
  if (!errors.slug) {
    const [taken] = await db
      .select({ id: gateways.id })
      .from(gateways)
      .where(id ? and(eq(gateways.slug, values.slug), ne(gateways.id, id)) : eq(gateways.slug, values.slug))
      .limit(1);
    if (taken) errors.slug = "That paid address is taken.";
  }
  if (Object.keys(errors).length) return { ok: false, errors, values };

  const fields = {
    slug: values.slug,
    name: values.name,
    description: values.description,
    upstreamUrl: upstream.ok ? upstream.url.href.replace(/\/+$/, "") : values.upstreamUrl,
    upstreamAuthHeader: values.authHeader || null,
    upstreamAuthSecret: secret
      ? encryptSecret(secret)
      : clearSecret || !values.authHeader
        ? null
        : (existing?.upstreamAuthSecret ?? null),
    priceUsd: priceValid ? values.priceUsd : "0",
    acceptUsdg,
    autonomoAmount: acceptAutonomo ? values.autonomoAmount : null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(gateways).set(fields).where(eq(gateways.id, existing.id));
  } else {
    await db.insert(gateways).values({ ...fields, owner, payTo: await ownerPayTo(owner) });
  }
  revalidatePath("/dashboard");
  revalidateCatalog();
  // The query flag drives the "saved" / "live" confirmation on the gateway page.
  redirect(`/dashboard/${values.slug}?${existing ? "saved" : "launched"}=1`);
}

async function ownedId(form: FormData) {
  const owner = await requireOwner();
  const db = await getDb();
  const [g] = await db
    .select()
    .from(gateways)
    .where(and(eq(gateways.id, Number(form.get("id"))), eq(gateways.owner, owner)))
    .limit(1);
  if (!g) throw new Error("Not found");
  return { db, g };
}

export async function setGatewayStatus(form: FormData) {
  const { db, g } = await ownedId(form);
  await db
    .update(gateways)
    .set({ status: g.status === "active" ? "paused" : "active", updatedAt: new Date() })
    .where(eq(gateways.id, g.id));
  revalidatePath(`/dashboard/${g.slug}`);
  revalidateCatalog();
}

export async function requestListing(form: FormData) {
  const { db, g } = await ownedId(form);
  if (g.listing === "unlisted" || g.listing === "rejected") {
    await db.update(gateways).set({ listing: "pending" }).where(eq(gateways.id, g.id));
  }
  revalidatePath(`/dashboard/${g.slug}`);
  revalidateCatalog();
}

export async function deleteGateway(form: FormData) {
  const { db, g } = await ownedId(form);
  if (String(form.get("confirm") ?? "").trim() !== g.slug) return;
  if (g.projectId) await db.update(schema.projects).set({ status: "hidden" }).where(eq(schema.projects.id, g.projectId));
  await db.delete(gateways).where(eq(gateways.id, g.id));
  revalidatePath("/dashboard");
  revalidateCatalog();
  redirect("/dashboard");
}

/**
 * The checks every Safe goes through before an owner's APIs can pay it. Returns an error to show, or the Safe and
 * the wallet the owner's APIs pay now (null while they pay the sign-in wallet).
 */
type SafeCheck =
  | { error: string }
  | { safe: { owners: string[]; threshold: number; version: string }; current: string | null };

async function checkSafe(owner: string, payTo: string): Promise<SafeCheck> {
  if (!isAddress(payTo) || /^0x0+$/.test(payTo)) return { error: "That isn't a wallet address." };
  if (payTo === owner) return { error: "That's your sign-in wallet. Enter your Safe's address." };
  const db = await getDb();
  const [mine] = await db.select({ payTo: gateways.payTo }).from(gateways).where(eq(gateways.owner, owner)).limit(1);
  if (!mine) return { error: "Launch an API first, then choose where it gets paid." };
  if (mine.payTo === payTo) return { error: "Your APIs already pay that Safe." };
  const safe = await safeInfo(payTo).catch(() => undefined);
  if (safe === undefined) return { error: "We couldn't read Robinhood Chain just now. Try again in a minute." };
  if (!safe) return { error: "That address isn't a Safe on Robinhood Chain. Create one first, as the guide shows." };
  if (safe.threshold < 2) return { error: "This Safe needs only one signature to move money. Set it to need at least 2, then try again." };
  return { safe, current: mine.payTo };
}

export type FirstSafeState = {
  error?: string;
  // Filled once the Safe passes the checks: what to show, what to sign, and a sealed copy of it to send back.
  safe?: { address: string; owners: string[]; threshold: number; version: string };
  message?: string;
  token?: string;
};

/** Checks the owner's first Safe and returns the message their sign-in wallet signs to set it. */
export async function prepareFirstSafe(rawPayTo: string): Promise<FirstSafeState> {
  const owner = await requireOwner();
  const payTo = rawPayTo.trim().slice(0, 64).toLowerCase();
  const check = await checkSafe(owner, payTo);
  if ("error" in check) return { error: check.error };
  if (check.current) return { error: "Your APIs already pay a Safe. Changing it needs a request below." };
  const message = firstSafeMessage(owner, payTo, new Date());
  return {
    safe: { address: payTo, ...check.safe },
    message,
    token: seal({ o: owner, p: payTo, m: message }, SAFE_SIGN_TTL_S),
  };
}

/** Sets the owner's first Safe once their sign-in wallet has signed the message from prepareFirstSafe. */
export async function setFirstSafe(token: string, signature: string): Promise<{ error?: string }> {
  const owner = await requireOwner();
  const signed = unseal<{ o: string; p: string; m: string }>(token);
  if (!signed || signed.o !== owner) return { error: "That took too long. Check the Safe again and sign the new message." };
  if (!isHex(signature)) return { error: "The signature couldn't be read. Try again." };
  // Signed by the sign-in wallet itself, not just this session's cookie.
  const valid = await verifyMessage({ address: owner as Hex, message: signed.m, signature }).catch(() => false);
  if (!valid) return { error: "That signature isn't from your sign-in wallet. Sign with the wallet shown above." };

  // Checked again: the Safe or the owner's APIs may have changed since the message was made.
  const check = await checkSafe(owner, signed.p);
  if ("error" in check) return { error: check.error };
  if (check.current) return { error: "Your APIs already pay a Safe. Changing it needs a request below." };

  const slugs = await applyPayTo(owner, signed.p, "pay_to_signed");
  if (!slugs.length) return { error: "Launch an API first, then choose where it gets paid." };
  const db = await getDb();
  await db
    .update(payToRequests)
    .set({ status: "cancelled", reviewedAt: new Date() })
    .where(and(eq(payToRequests.owner, owner), eq(payToRequests.status, "pending")));
  return {};
}

/** Asks /admin to move the owner's APIs from their current Safe to another. Replaces the Safe in any request waiting. */
export async function requestPayTo(form: FormData) {
  const owner = await requireOwner();
  const payTo = str(form, "payTo", 64).toLowerCase();
  const back = (note: string) => redirect(`/dashboard?${new URLSearchParams({ payTo, payToNote: note })}#payout`);
  const check = await checkSafe(owner, payTo);
  if ("error" in check) return back(check.error);
  if (!check.current) return back("Your first Safe doesn't need a request. Set it with a signature above.");

  const db = await getDb();
  await db
    .insert(payToRequests)
    .values({ owner, payTo })
    .onConflictDoUpdate({
      target: payToRequests.owner,
      targetWhere: sql`${payToRequests.status} = 'pending'`,
      set: { payTo, createdAt: new Date() },
    });
  revalidatePath("/dashboard");
  redirect(`/dashboard?${new URLSearchParams({ payToNote: "Request sent. Your APIs keep paying your current Safe until it's approved." })}#payout`);
}

export async function cancelPayToRequest() {
  const owner = await requireOwner();
  const db = await getDb();
  await db
    .update(payToRequests)
    .set({ status: "cancelled", reviewedAt: new Date() })
    .where(and(eq(payToRequests.owner, owner), eq(payToRequests.status, "pending")));
  revalidatePath("/dashboard");
}
