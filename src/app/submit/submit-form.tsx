"use client";

import { useActionState } from "react";
import { CATEGORIES } from "@/lib/constants";
import { CATEGORY_INFO } from "@/lib/categories";
import { submitProject, type SubmitState } from "./actions";

export function SubmitForm({ claim }: { claim?: string }) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitProject, { ok: false });

  if (state.ok) {
    return (
      <div className="rounded-lg border border-line bg-surface p-8">
        <h2 className="heading text-xl">Thanks, we got it.</h2>
        <p className="mt-2 text-muted">
          We review every launch by hand, usually within a few days. APIs with a live x402 endpoint go live
          fastest.
        </p>
      </div>
    );
  }

  const v = state.values ?? {};
  const err = state.errors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="claim" value={claim ?? ""} />
      <div className="hidden" aria-hidden>
        <label>
          Company <input name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Field label="Project name" name="name" error={err.name}>
        <input id="name" name="name" defaultValue={v.name} required maxLength={80} className="field" />
      </Field>
      <Field label="Website" name="website" error={err.website}>
        <input id="website" name="website" type="url" defaultValue={v.website} required placeholder="https://" className="field" />
      </Field>
      <Field label="Category" name="category" error={err.category}>
        <select id="category" name="category" defaultValue={v.category ?? ""} required className="field">
          <option value="" disabled>
            Choose…
          </option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_INFO[c].label}: {CATEGORY_INFO[c].blurb.toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What does it do?" name="description" error={err.description} hint="One or two sentences.">
        <textarea id="description" name="description" defaultValue={v.description} rows={3} maxLength={600} className="field" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="GitHub" name="github" error={err.github} optional>
          <input id="github" name="github" type="url" defaultValue={v.github} placeholder="https://github.com/…" className="field" />
        </Field>
        <Field label="X handle" name="twitter" error={err.twitter} optional>
          <input id="twitter" name="twitter" defaultValue={v.twitter} placeholder="@yourproject" className="field" />
        </Field>
      </div>
      <Field
        label="A paid x402 endpoint"
        name="endpointUrl"
        error={err.endpointUrl}
        optional
        hint="A URL that returns 402 Payment Required. We use it to verify the listing."
      >
        <input id="endpointUrl" name="endpointUrl" type="url" defaultValue={v.endpointUrl} placeholder="https://api.example.com/paid" className="field" />
      </Field>
      <Field label="How can we reach you?" name="contact" error={err.contact} optional hint="Email or handle. Not published.">
        <input id="contact" name="contact" defaultValue={v.contact} className="field" />
      </Field>
      <button
        disabled={pending}
        className="btn-brand px-5 py-2.5 text-sm"
      >
        {pending ? "Sending…" : "Request listing"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  optional,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label} {optional && <span className="font-normal text-faint">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-sm text-warn" role="alert">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}
