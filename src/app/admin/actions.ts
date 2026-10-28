"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb, schema } from "@/db";
import { isAuthorized } from "@/lib/admin-auth";
import { slugify } from "@/lib/slug";

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
}

export async function rejectSubmission(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  await db
    .update(schema.submissions)
    .set({ status: "rejected", reviewedAt: new Date(), reviewNote: String(form.get("note") ?? "") || null })
    .where(eq(schema.submissions.id, Number(form.get("id"))));
  revalidatePath("/admin");
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
}
