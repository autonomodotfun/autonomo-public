"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAddress } from "viem";
import { getDb, schema } from "@/db";
import { isAuthorized } from "@/lib/admin-auth";
import { TOKEN } from "@/lib/constants";
import { gatewayOffers, payeeOf } from "@/lib/gateway";
import { applyPayTo } from "@/lib/pay-to";
import { USDG } from "@/lib/payments";
import { slugify } from "@/lib/slug";
import { revalidateCatalog } from "@/lib/queries";

// Server actions can be invoked from any route, so each one re-checks auth rather than trusting the proxy.
async function requireAdmin() {
  if (!isAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
}

// Moves all of a creator's gateways to a new wallet, which then signs in for them and gets paid unless they have a
// separate pay-to wallet. One statement, so it all applies or none.
export async function switchCreatorWallet(form: FormData) {
  await requireAdmin();

  const from = String(form.get("from") ?? "").trim().toLowerCase();
  const to = String(form.get("to") ?? "").trim().toLowerCase();
  const back = (message: string) => `/admin?${new URLSearchParams({ from, to, switch: message })}#switch-wallet`;
  if (!isAddress(from) || !isAddress(to) || from === to || /^0x0+$/.test(to)) redirect(back("Those addresses aren't valid."));
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== to.slice(-6)) redirect(back("The last 6 characters didn't match."));

  const db = await getDb();
  const result = await db.execute<{ slugs: string[] }>(sql`
    with moved as (
      update gateways set owner = ${to}, updated_at = now() where owner = ${from} returning slug, project_id
    ), listed as (
      update endpoints set pay_to = ${to}
      where facilitator = 'autonomo' and lower(pay_to) = ${from} and project_id in (select project_id from moved)
    ), logged as (
      insert into wallet_switches (from_owner, to_owner, slugs)
      select ${from}::text, ${to}::text, array_agg(slug) from moved having count(*) > 0
      returning slugs
    )
    select slugs from logged`);
  const rows = "rows" in result ? result.rows : (result as unknown as { slugs: string[] }[]);
  if (!rows.length) redirect(back("That wallet has no APIs."));

  revalidatePath("/admin");
  revalidateCatalog();
  redirect(`/admin?${new URLSearchParams({ switch: `Moved ${rows[0].slugs.length} APIs to ${to}.` })}#switch-wallet`);
}

// Sets the wallet that all of an owner's gateways pay, such as a Safe. The owner keeps signing in. Naming the owner
// itself clears it.
export async function setCreatorPayTo(form: FormData) {
  await requireAdmin();

  const owner = String(form.get("owner") ?? "").trim().toLowerCase();
  const payTo = String(form.get("payTo") ?? "").trim().toLowerCase();
  const back = (message: string) => `/admin?${new URLSearchParams({ owner, payTo, payToNote: message })}#pay-to`;
  if (!isAddress(owner) || !isAddress(payTo) || /^0x0+$/.test(payTo)) redirect(back("Those addresses aren't valid."));
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== payTo.slice(-6)) redirect(back("The last 6 characters didn't match."));

  const slugs = await applyPayTo(owner, payTo);
  if (!slugs.length) redirect(back("That wallet has no APIs."));
  redirect(`/admin?${new URLSearchParams({ payToNote: `${slugs.length} APIs now pay ${payTo}.` })}#pay-to`);
}

// A creator's request from the dashboard to change the Safe they set. Approving it applies it like setCreatorPayTo, with the same confirmation.
export async function approvePayToRequest(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  const back = (message: string) => `/admin?${new URLSearchParams({ requestNote: message })}#pay-to-requests`;
  const db = await getDb();
  const { payToRequests } = schema;
  const [req] = await db.select().from(payToRequests).where(and(eq(payToRequests.id, id), eq(payToRequests.status, "pending"))).limit(1);
  if (!req) redirect(back("That request isn't waiting any more."));
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== req.payTo.slice(-6)) redirect(back("The last 6 characters didn't match."));

  const slugs = await applyPayTo(req.owner, req.payTo);
  if (!slugs.length) redirect(back("That wallet has no APIs any more, so nothing changed."));
  await db.update(payToRequests).set({ status: "approved", reviewedAt: new Date() }).where(eq(payToRequests.id, id));
  redirect(back(`${slugs.length} APIs now pay ${req.payTo}.`));
}

export async function rejectPayToRequest(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  const { payToRequests } = schema;
  await db
    .update(payToRequests)
    .set({ status: "rejected", reviewedAt: new Date(), reviewNote: String(form.get("note") ?? "").trim().slice(0, 300) || null })
    .where(and(eq(payToRequests.id, Number(form.get("id"))), eq(payToRequests.status, "pending")));
  revalidatePath("/admin");
  revalidatePath("/dashboard");
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
      asset: offer ? (offer.kind === "usdg" ? USDG.address : TOKEN.address) : null,
      amount: offer ? offer.atomic : null,
      priceUsd: g.acceptUsdg ? g.priceUsd : null,
      payTo: payeeOf(g),
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
