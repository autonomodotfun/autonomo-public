"use server";

import { z } from "zod";
import { getDb, schema } from "@/db";
import { CATEGORIES } from "@/db/schema";

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => v || undefined)
  .pipe(z.url({ protocol: /^https?$/, message: "Must be an http(s) URL" }).optional());

const SubmissionInput = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  website: z.url({ protocol: /^https?$/, message: "Enter the project's website (https://…)" }).max(500),
  category: z.enum(CATEGORIES, { message: "Choose a category" }),
  description: z.string().trim().min(20, "Write at least a sentence (20+ characters)").max(600),
  github: optionalUrl,
  twitter: z
    .string()
    .trim()
    .max(50)
    .regex(/^@?\w{0,30}$/, "Just the handle, e.g. @yourproject")
    .transform((v) => v.replace(/^@/, "") || undefined),
  endpointUrl: optionalUrl,
  contact: z.string().trim().max(200).transform((v) => v || undefined),
  claim: z.string().trim().max(80).transform((v) => v || undefined),
});

export type SubmitState = { ok: boolean; errors?: Record<string, string>; values?: Record<string, string> };

export async function submitProject(_prev: SubmitState, form: FormData): Promise<SubmitState> {
  const values = Object.fromEntries(
    ["name", "website", "category", "description", "github", "twitter", "endpointUrl", "contact", "claim"].map((k) => [
      k,
      String(form.get(k) ?? ""),
    ]),
  );
  // Honeypot: real users never see or fill this field.
  if (String(form.get("company") ?? "")) return { ok: true };

  const parsed = SubmissionInput.safeParse(values);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, errors, values };
  }
  const { claim, ...data } = parsed.data;
  const db = await getDb();
  await db.insert(schema.submissions).values({
    ...data,
    reviewNote: claim ? `Edit request for /projects/${claim}` : null,
  });
  return { ok: true };
}
