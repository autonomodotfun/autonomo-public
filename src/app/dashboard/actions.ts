"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { checkUpstream, encryptSecret, RESERVED_SLUGS, secretsEnabled } from "@/lib/gateway";
import { currentOwner } from "@/lib/session";
import { revalidateCatalog } from "@/lib/queries";

const { gateways } = schema;

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
  if (secret && !values.authHeader) errors.authHeader = "Name the header the secret goes in.";
  if (secret && !secretsEnabled()) errors.authSecret = "Storing upstream secrets isn't enabled on this deployment.";

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
    if (taken) errors.slug = "That URL is taken.";
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
    await db.insert(gateways).values({ ...fields, owner });
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
