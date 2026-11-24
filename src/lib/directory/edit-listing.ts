import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

// Edits a directory listing's text and links from /admin: for fixing what a submission got wrong (a website that is
// an API address, a guide link left in the description) and for giving a listing its logo. Autonomo gateways keep
// their name, description and website from the gateway itself, so only their logo and links can be changed here.

export type ListingFields = {
  description: string;
  website: string | null;
  docs: string | null;
  github: string | null;
  twitter: string | null;
  logoUrl: string | null;
};

export type EditResult = { ok: true; message: string } | { ok: false; error: string };

const MAX_DESCRIPTION = 1000;

/** An https:// address, or nothing. */
function httpsUrl(raw: string, label: string): { value: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return { error: `${label} must start with https://.` };
    return { value: u.toString() };
  } catch {
    return { error: `${label} isn't a valid URL.` };
  }
}

/** A logo: an image on this site (a path like /qhooks-logo.png, from /public) or an https:// address. */
function logo(raw: string): { value: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  if (/^\/[a-z0-9][a-z0-9._/-]*\.(png|jpe?g|svg|webp|gif)$/i.test(v) && !v.includes("..")) return { value: v };
  const url = httpsUrl(v, "Logo");
  if ("error" in url) return { error: "Logo must be a path on this site (like /qhooks-logo.png) or an https:// address." };
  return url;
}

/** An X handle, from a handle, @handle or an x.com / twitter.com link. */
function handle(raw: string): { value: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  const m = v.match(/^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/)?@?([A-Za-z0-9_]{1,15})\/?$/);
  return m ? { value: m[1] } : { error: "X must be a handle, like qHooks_ or https://x.com/qHooks_." };
}

/** Reads and checks the form's fields. Any field left blank is cleared. */
export function parseListingFields(form: {
  description: string;
  website: string;
  docs: string;
  github: string;
  twitter: string;
  logoUrl: string;
}): { ok: true; fields: ListingFields } | { ok: false; error: string } {
  const description = form.description.replace(/\s+/g, " ").trim();
  if (description.length > MAX_DESCRIPTION) return { ok: false, error: `The description is over ${MAX_DESCRIPTION} characters.` };
  const checks = {
    website: httpsUrl(form.website, "Website"),
    docs: httpsUrl(form.docs, "Docs"),
    github: httpsUrl(form.github, "GitHub"),
    twitter: handle(form.twitter),
    logoUrl: logo(form.logoUrl),
  };
  for (const c of Object.values(checks)) if ("error" in c) return { ok: false, error: c.error };
  const value = (c: { value: string | null } | { error: string }) => ("value" in c ? c.value : null);
  return {
    ok: true,
    fields: {
      description,
      website: value(checks.website),
      docs: value(checks.docs),
      github: value(checks.github),
      twitter: value(checks.twitter),
      logoUrl: value(checks.logoUrl),
    },
  };
}

/** Saves the fields to the listing. For an Autonomo gateway, only the logo and the docs, GitHub and X links. */
export async function editListing(slug: string, fields: ListingFields): Promise<EditResult> {
  const db = await getDb();
  const [project] = await db
    .select({ id: schema.projects.id, source: schema.projects.source })
    .from(schema.projects)
    .where(eq(schema.projects.slug, slug.trim()))
    .limit(1);
  if (!project) return { ok: false, error: `No listing at /projects/${slug}.` };
  const { description, website, ...links } = fields;
  const gateway = project.source === "gateway";
  if (!gateway && !description) return { ok: false, error: "The description can't be empty." };
  await db
    .update(schema.projects)
    .set({ ...links, ...(gateway ? {} : { description, website }), updatedAt: new Date() })
    .where(eq(schema.projects.id, project.id));
  return { ok: true, message: `/projects/${slug} saved.` };
}
