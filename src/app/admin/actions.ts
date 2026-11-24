"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAddress } from "viem";
import { getDb, schema } from "@/db";
import { isAuthorized } from "@/lib/admin/admin-auth";
import { logAdmin } from "@/lib/admin/admin-log";
import { attachEndpoint as attach, detachEndpoint as detach, moveEndpoint as move } from "@/lib/directory/attach-endpoint";
import { editListing as saveListing, parseListingFields } from "@/lib/directory/edit-listing";
import { TOKEN } from "@/lib/constants";
import { gatewayNetworks, gatewayOffers, payeeOf, syncGatewayNetworks } from "@/lib/gateway/gateway";
import { applyPayTo } from "@/lib/payments/pay-to";
import { ROUTER } from "@/lib/router/router";
import { parseRouteSettings, type RouteSettings } from "@/lib/router/router-apis";
import { runRouterJobs, saveRouteSettings, stopRouting, testAndEnable } from "@/lib/router/router-gateway";
import { USDG } from "@/lib/payments/payments";
import { slugify } from "@/lib/directory/slug";
import { revalidateCatalog } from "@/lib/directory/queries";

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
  const back = (message: string) => `/admin?${new URLSearchParams({ tab: "payouts", from, to, switch: message })}#switch-wallet`;
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

  await logAdmin({ kind: "wallet_switched", subject: from, detail: `to ${to}: ${rows[0].slugs.map((s) => `/x/${s}`).join(", ")}` });
  revalidatePath("/admin");
  revalidateCatalog();
  redirect(`/admin?${new URLSearchParams({ tab: "payouts", switch: `Moved ${rows[0].slugs.length} APIs to ${to}.` })}#switch-wallet`);
}

// Sets the wallet that all of an owner's gateways pay, such as a Safe. The owner keeps signing in. Naming the owner
// itself clears it.
export async function setCreatorPayTo(form: FormData) {
  await requireAdmin();

  const owner = String(form.get("owner") ?? "").trim().toLowerCase();
  const payTo = String(form.get("payTo") ?? "").trim().toLowerCase();
  const back = (message: string) => `/admin?${new URLSearchParams({ tab: "payouts", owner, payTo, payToNote: message })}#pay-to`;
  if (!isAddress(owner) || !isAddress(payTo) || /^0x0+$/.test(payTo)) redirect(back("Those addresses aren't valid."));
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== payTo.slice(-6)) redirect(back("The last 6 characters didn't match."));

  const slugs = await applyPayTo(owner, payTo);
  if (!slugs.length) redirect(back("That wallet has no APIs."));
  await logAdmin({ kind: "pay_to_set", subject: owner, detail: `${slugs.length} APIs now pay ${payTo}` });
  redirect(`/admin?${new URLSearchParams({ tab: "payouts", payToNote: `${slugs.length} APIs now pay ${payTo}.` })}#pay-to`);
}

// A creator's request from the dashboard to change the Safe they set. Approving it applies it like setCreatorPayTo, with the same confirmation.
export async function approvePayToRequest(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  const back = (message: string) => `/admin?${new URLSearchParams({ tab: "payouts", requestNote: message })}#pay-to-requests`;
  const db = await getDb();
  const { payToRequests } = schema;
  const [req] = await db.select().from(payToRequests).where(and(eq(payToRequests.id, id), eq(payToRequests.status, "pending"))).limit(1);
  if (!req) redirect(back("That request isn't waiting any more."));
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== req.payTo.slice(-6)) redirect(back("The last 6 characters didn't match."));

  const slugs = await applyPayTo(req.owner, req.payTo);
  if (!slugs.length) redirect(back("That wallet has no APIs any more, so nothing changed."));
  await db.update(payToRequests).set({ status: "approved", reviewedAt: new Date() }).where(eq(payToRequests.id, id));
  await logAdmin({ kind: "pay_to_request_approved", subject: req.owner, detail: `${slugs.length} APIs now pay ${req.payTo}` });
  redirect(back(`${slugs.length} APIs now pay ${req.payTo}.`));
}

export async function rejectPayToRequest(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  const { payToRequests } = schema;
  const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;
  const rejected = await db
    .update(payToRequests)
    .set({ status: "rejected", reviewedAt: new Date(), reviewNote: note })
    .where(and(eq(payToRequests.id, Number(form.get("id"))), eq(payToRequests.status, "pending")))
    .returning({ owner: payToRequests.owner, payTo: payToRequests.payTo });
  for (const r of rejected) await logAdmin({ kind: "pay_to_request_rejected", subject: r.owner, detail: `asked to pay ${r.payTo}`, note });
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
  await logAdmin({ kind: "submission_approved", subject: sub.name, detail: `published as /projects/${slug}` });
  revalidatePath("/admin");
  revalidateCatalog();
}

export async function rejectSubmission(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;
  const rejected = await db
    .update(schema.submissions)
    .set({ status: "rejected", reviewedAt: new Date(), reviewNote: note })
    .where(and(eq(schema.submissions.id, Number(form.get("id"))), eq(schema.submissions.status, "pending")))
    .returning({ name: schema.submissions.name });
  for (const r of rejected) await logAdmin({ kind: "submission_rejected", subject: r.name, note });
  revalidatePath("/admin");
  revalidateCatalog();
}

export async function setProjectFlags(form: FormData) {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "").trim();
  const status = String(form.get("status") ?? "");
  const featured = form.get("featured");
  const db = await getDb();
  const changed = await db
    .update(schema.projects)
    .set({
      ...(status === "approved" || status === "hidden" ? { status } : {}),
      ...(featured === "on" || featured === "off" ? { featured: featured === "on" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.slug, slug))
    .returning({ slug: schema.projects.slug });
  if (changed.length) {
    if (status === "approved" || status === "hidden") await logAdmin({ kind: status === "hidden" ? "project_hidden" : "project_shown", subject: slug });
    if (featured === "on" || featured === "off") await logAdmin({ kind: featured === "on" ? "project_featured" : "project_unfeatured", subject: slug });
  }
  revalidatePath("/admin");
  revalidateCatalog();
}

// Publishes a hosted gateway in the catalog as a paid service with one endpoint (the gateway URL).
async function listGateway(id: number) {
  const db = await getDb();
  const [g] = await db.select().from(schema.gateways).where(eq(schema.gateways.id, id)).limit(1);
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
        networks: gatewayNetworks(g),
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
  // An entry made before Base existed, or before the API's Base setting changed, is filed under today's chains.
  await syncGatewayNetworks({ ...g, projectId });
  await logAdmin({ kind: "listing_approved", subject: `/x/${g.slug}`, detail: g.name, gatewayId: g.id });
}

export async function approveGateway(form: FormData) {
  await requireAdmin();
  await listGateway(Number(form.get("id")));
  revalidatePath("/admin");
  revalidateCatalog();
}

/** "List selected": every ticked API on the review tab, one after another, so each gets its own directory page. */
export async function approveGateways(form: FormData) {
  await requireAdmin();
  const ids = [...new Set(form.getAll("ids").map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
  for (const id of ids) await listGateway(id);
  revalidatePath("/admin");
  revalidateCatalog();
}

/** Rejects a listing. The reason, if one is typed, is shown to the creator on the API's dashboard page. */
export async function rejectGateway(form: FormData) {
  await requireAdmin();
  const db = await getDb();
  const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;
  const rejected = await db
    .update(schema.gateways)
    .set({ listing: "rejected" })
    .where(and(eq(schema.gateways.id, Number(form.get("id"))), eq(schema.gateways.listing, "pending")))
    .returning({ id: schema.gateways.id, slug: schema.gateways.slug, name: schema.gateways.name });
  for (const g of rejected) await logAdmin({ kind: "listing_rejected", subject: `/x/${g.slug}`, detail: g.name, note, gatewayId: g.id });
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidateCatalog();
}

/** Pauses or resumes any API from the All APIs tab. A paused API stops taking payments until it is resumed. */
export async function setApiStatus(form: FormData) {
  await requireAdmin();
  const status = form.get("status") === "paused" ? "paused" : "active";
  const db = await getDb();
  const changed = await db
    .update(schema.gateways)
    .set({ status, updatedAt: new Date() })
    .where(inArray(schema.gateways.id, [Number(form.get("id"))]))
    .returning({ id: schema.gateways.id, slug: schema.gateways.slug });
  for (const g of changed) await logAdmin({ kind: status === "paused" ? "api_paused" : "api_resumed", subject: `/x/${g.slug}`, gatewayId: g.id });
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidateCatalog();
}

// Adds an x402 endpoint to a directory listing from its own 402 answer (see src/lib/directory/attach-endpoint.ts).
export async function attachListingEndpoint(form: FormData) {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const method = String(form.get("method") ?? "GET");
  const result = await attach(slug, url, method);
  if (result.ok) {
    await logAdmin({ kind: "endpoint_attached", subject: `/projects/${slug}`, detail: result.message });
    revalidateCatalog();
  }
  const listingNote = result.ok ? result.message : result.error;
  const moveable: Record<string, string> = !result.ok && result.move ? { moveUrl: result.move.url, moveMethod: result.move.method } : {};
  redirect(`/admin?${new URLSearchParams({ tab: "directory", listing: slug, listingNote, ...moveable })}#endpoints`);
}

export async function detachListingEndpoint(form: FormData) {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "").trim();
  const result = await detach(slug, Number(form.get("id")));
  if (result.ok) {
    await logAdmin({ kind: "endpoint_detached", subject: `/projects/${slug}`, detail: result.message });
    revalidateCatalog();
  }
  const listingNote = result.ok ? result.message : result.error;
  redirect(`/admin?${new URLSearchParams({ tab: "directory", listing: slug, listingNote })}#endpoints`);
}

// Moves an endpoint added here to another listing, for one filed under the wrong listing.
export async function moveListingEndpoint(form: FormData) {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "").trim();
  const result = await move(slug, String(form.get("url") ?? ""), String(form.get("method") ?? "GET"));
  if (result.ok) {
    await logAdmin({ kind: "endpoint_moved", subject: `/projects/${slug}`, detail: result.message });
    revalidateCatalog();
  }
  const listingNote = result.ok ? result.message : result.error;
  redirect(`/admin?${new URLSearchParams({ tab: "directory", listing: slug, listingNote })}#endpoints`);
}

// Edits a listing's description, links and logo (see src/lib/directory/edit-listing.ts).
export async function editListing(form: FormData) {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "").trim();
  const field = (name: string) => String(form.get(name) ?? "");
  const parsed = parseListingFields({
    description: field("description"),
    website: field("website"),
    docs: field("docs"),
    github: field("github"),
    twitter: field("twitter"),
    logoUrl: field("logoUrl"),
  });
  const result = parsed.ok ? await saveListing(slug, parsed.fields) : parsed;
  if (result.ok) {
    await logAdmin({ kind: "listing_edited", subject: `/projects/${slug}` });
    revalidateCatalog();
  }
  const listingNote = result.ok ? result.message : result.error;
  redirect(`/admin?${new URLSearchParams({ tab: "directory", listing: slug, listingNote })}#edit`);
}

// ---------- the Router tab ----------

const routerBack = (message: string) => `/admin?${new URLSearchParams({ tab: "router", routerNote: message })}`;

/** Runs the format test on one API with a real call. If it passes, the API is switched on for routing. */
export async function testRouting(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  let message: string;
  try {
    const result = await testAndEnable(id);
    if (!result) message = "That API wasn't found.";
    else if (result.test.ok) {
      message = `/x/${result.slug} passed the format test${result.test.ms === null ? "" : ` in ${result.test.ms} ms`}. It is on for routing and will be picked once it has ${ROUTER.measuredWindow} measured calls.`;
      await logAdmin({ kind: "routing_enabled", subject: `/x/${result.slug}`, gatewayId: id });
    } else if (result.test.wait !== undefined) {
      message = `/x/${result.slug} says it is not ready yet. Run the test again in ${result.test.wait} seconds. Nothing was changed.`;
    } else {
      message = `/x/${result.slug} did not pass the format test: ${result.test.reason}. Nothing was changed.`;
    }
  } catch (e) {
    console.error("format test failed", e);
    message = "The test couldn't be run just now. Try again.";
  }
  revalidatePath("/admin");
  redirect(routerBack(message));
}

/** Takes one API out of routing. It stays callable by name. */
export async function stopRoutingApi(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  const slug = await stopRouting(id);
  if (slug) await logAdmin({ kind: "routing_stopped", subject: `/x/${slug}`, gatewayId: id });
  revalidatePath("/admin");
  redirect(routerBack(slug ? `/x/${slug} is out of routing. It can still be called by name.` : "That API wasn't found."));
}

/** Saves an API's capability, path and mapping, or clears them. The API then has to pass the format test again. */
export async function saveRouting(form: FormData) {
  await requireAdmin();
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const capability = String(form.get("capability") ?? "").trim();
  const db = await getDb();
  const [g] = await db.select({ id: schema.gateways.id }).from(schema.gateways).where(eq(schema.gateways.slug, slug)).limit(1);
  if (!g) redirect(`${routerBack(`No API at /x/${slug}.`)}#routing-settings`);

  let settings: RouteSettings | null = null;
  if (capability) {
    const parsed = parseRouteSettings(capability, String(form.get("path") ?? ""), String(form.get("mapping") ?? ""));
    if (!parsed.ok) redirect(`${routerBack(parsed.error)}#routing-settings`);
    settings = parsed.settings;
  }
  await saveRouteSettings(g.id, settings);
  await logAdmin({ kind: "routing_settings", subject: `/x/${slug}`, detail: settings ? `${settings.capability} ${settings.path}` : "cleared", gatewayId: g.id });
  revalidatePath("/admin");
  redirect(routerBack(settings ? `Saved for /x/${slug}. Run its format test to switch it on.` : `Routing settings cleared for /x/${slug}.`));
}

/** Runs the probes that are due right now, without waiting for the scheduled run. */
export async function runRouterJobsNow() {
  await requireAdmin();
  let message: string;
  try {
    const run = await runRouterJobs(40_000);
    const failed = run.probes.failed.map((f) => `${f.slug} (${f.reason})`).join(", ");
    message =
      `Ran ${run.probes.run} ${run.probes.run === 1 ? "probe" : "probes"} and ${run.uptime.checked} uptime ${run.uptime.checked === 1 ? "check" : "checks"}.` +
      (failed ? ` Failed: ${failed}.` : "") +
      (run.probes.real ? ` ${run.probes.real} used an input an agent paid for.` : "") +
      (run.probes.waiting.length ? ` Not ready yet, asked again on a later run: ${run.probes.waiting.join(", ")}.` : "") +
      (run.probes.noAnswer.length ? ` No answer for an agent's input, not counted: ${run.probes.noAnswer.join(", ")}.` : "") +
      (run.uptime.down.length ? ` Down: ${run.uptime.down.join(", ")}.` : "") +
      (run.slashed.length ? ` Slashed, not routed for 30 days: ${run.slashed.join(", ")}.` : "") +
      (run.probes.left ? ` ${run.probes.left} left for the next run.` : "");
  } catch (e) {
    console.error("router jobs failed", e);
    message = "The probes couldn't be run just now. Try again.";
  }
  revalidatePath("/admin");
  redirect(routerBack(message));
}
