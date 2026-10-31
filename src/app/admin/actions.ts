"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb, schema } from "@/db";
import { isAuthorized } from "@/lib/admin-auth";
import { TOKEN } from "@/lib/constants";
import { gatewayOffers } from "@/lib/gateway";
import { USDG } from "@/lib/pro";
import { slugify } from "@/lib/slug";
import { revalidateCatalog } from "@/lib/queries";

// Server actions can be invoked from any route, so each one re-checks auth rather than trusting the proxy.
async function requireAdmin() {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
}

export async function approveSubmission(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  const db = await getDb();
  const [sub] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, id)).limit(1);
  if (!sub || sub.status !== "pending") return;

  const taken = new Set(
    (await db.select({ slug: schema.projects.slug }).from(schema.projects)).map((r) => r.slug),
  );
  let slug = slugify(sub.name);
  for (let i = 2; taken.has(slug); i++) slug = `${slugify(sub.name)}-${i}`;

  const [project] = await db
    .insert(schema.projects)
    .values({
      slug,
      name: sub.name,
      description: sub.description,
      category: sub.category,
      website: sub.website,
      github: sub.github,
      twitter: sub.twitter,
      status: "approved",
      source: "submission",
    })
    .returning({ id: schema.projects.id });
  await db
    .update(schema.submissions)
    .set({ status: "approved", projectId: project.id, reviewedAt: new Date() })
    .where(eq(schema.submissions.id, id));
  revalidatePath("/admin");
  revalidateCatalog();
}

export async function rejectSubmission(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  await db
    .update(schema.submissions)
    .set({ status: "rejected", reviewedAt: new Date(), reviewNote: String(form.get("note") ?? "") || null })
    .where(eq(schema.submissions.id, Number(form.get("id"))));
  revalidatePath("/admin");
  revalidateCatalog();
}

export async function setProjectFlags(form: FormData) {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "").trim();
  const status = String(form.get("status") ?? "");
  const featured = form.get("featured");
  const db = await getDb();
  await db
    .update(schema.projects)
    .set({
      ...(status === "approved" || status === "hidden" ? { status } : {}),
      ...(featured === "on" || featured === "off" ? { featured: featured === "on" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.slug, slug));
  revalidatePath("/admin");
  revalidateCatalog();
}

// Publishes a hosted gateway in the catalog as a paid service with one endpoint (the gateway URL).
export async function approveGateway(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  const [g] = await db.select().from(schema.gateways).where(eq(schema.gateways.id, Number(form.get("id")))).limit(1);
  if (!g || g.listing !== "pending") return;

  const offer = gatewayOffers(g)[0];
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://autonomo.fun";
  const url = `${site}/x/${g.slug}`;

  let projectId = g.projectId;
  if (projectId) {
    await db.update(schema.projects).set({ status: "approved", updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
  } else {
    const taken = new Set((await db.select({ slug: schema.projects.slug }).from(schema.projects)).map((r) => r.slug));
    let slug = slugify(g.name);
    for (let i = 2; taken.has(slug); i++) slug = `${slugify(g.name)}-${i}`;
    const [project] = await db
      .insert(schema.projects)
      .values({
        slug,
        name: g.name,
        description: g.description || `${g.name}, launched on Autonomo.`,
        category: "service",
        website: url,
        tags: ["autonomo-gateway"],
        networks: ["eip155:4663"],
        status: "approved",
        source: "gateway",
        endpointCount: 1,
        minPriceUsd: g.acceptUsdg ? g.priceUsd : null,
      })
      .returning({ id: schema.projects.id });
    projectId = project.id;
    await db.insert(schema.endpoints).values({
      projectId,
      url,
      method: "GET",
      description: g.description,
      network: "eip155:4663",
      asset: offer && offer.kind !== "usdc" ? (offer.kind === "usdg" ? USDG.address : TOKEN.address) : null,
      amount: offer && offer.kind !== "usdc" ? offer.atomic : null,
      priceUsd: g.acceptUsdg ? g.priceUsd : null,
      payTo: g.owner,
      scheme: "exact",
      facilitator: "autonomo",
      x402Version: 2,
    });
  }
  await db.update(schema.gateways).set({ listing: "listed", projectId }).where(eq(schema.gateways.id, g.id));
  revalidatePath("/admin");
  revalidateCatalog();
}

export async function rejectGateway(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  await db.update(schema.gateways).set({ listing: "rejected" }).where(eq(schema.gateways.id, Number(form.get("id"))));
  revalidatePath("/admin");
  revalidateCatalog();
}
