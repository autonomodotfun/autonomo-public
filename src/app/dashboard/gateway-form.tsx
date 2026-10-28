"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { saveGateway, type GatewayFormState } from "./actions";

export type GatewayDefaults = {
  id?: number;
  name: string;
  slug: string;
  description: string;
  upstreamUrl: string;
  authHeader: string;
  priceUsd: string;
  acceptUsdg: boolean;
  autonomoAmount: string;
};

const EMPTY: GatewayDefaults = {
  name: "",
  slug: "",
  description: "",
  upstreamUrl: "",
  authHeader: "",
  priceUsd: "0.01",
  acceptUsdg: true,
  autonomoAmount: "",
};

export function GatewayForm({
  defaults = EMPTY,
  site,
  secretSet = false,
  secretsEnabled,
}: {
  defaults?: GatewayDefaults;
  site: string;
  secretSet?: boolean;
  secretsEnabled: boolean;
}) {
  const [state, action, pending] = useActionState<GatewayFormState, FormData>(saveGateway, { ok: false });
  const v = state.values;
  const err = state.errors ?? {};
  const [slug, setSlug] = useState(v?.slug ?? defaults.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(defaults.slug));
  const [acceptAutonomo, setAcceptAutonomo] = useState(v ? v.acceptAutonomo === "on" : Boolean(defaults.autonomoAmount));
  // Controlled so they survive a failed submit: React resets uncontrolled fields after a form action, and the
  // server never sends the secret back.
  const [acceptUsdg, setAcceptUsdg] = useState(v ? v.acceptUsdg === "on" : defaults.acceptUsdg);
  const [priceUsd, setPriceUsd] = useState(v?.priceUsd ?? defaults.priceUsd);
  const [autonomoAmount, setAutonomoAmount] = useState(v?.autonomoAmount ?? defaults.autonomoAmount);
  const [secret, setSecret] = useState("");

  return (
    <form action={action} className="space-y-6" noValidate>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      <Field label="API name" name="name" error={err.name}>
        <input
          id="name"
          name="name"
          defaultValue={v?.name ?? defaults.name}
          maxLength={80}
          className="field"
          onChange={(e) => {
            if (!slugTouched) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40));
          }}
        />
      </Field>

      <Field label="Gateway URL" name="slug" error={err.slug} hint={`Agents call ${site}/x/${slug || "your-api"}/…`}>
        <div className="flex items-center rounded-md border border-line bg-surface focus-within:outline-2 focus-within:outline-accent">
          <span className="pl-3 font-mono text-xs text-faint">/x/</span>
          <input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            maxLength={40}
            className="w-full bg-transparent px-1 py-2 font-mono text-sm outline-none"
          />
        </div>
      </Field>

      <Field label="What does it do?" name="description" error={err.description} optional hint="Shown to agents in the 402 response.">
        <textarea id="description" name="description" defaultValue={v?.description ?? defaults.description} rows={2} maxLength={300} className="field" />
      </Field>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-medium">Your existing API</legend>
        <Field
          label="Upstream base URL"
          name="upstreamUrl"
          error={err.upstreamUrl}
          hint="Requests to /x/your-api/forecast go to <this URL>/forecast. Must be https."
        >
          <input id="upstreamUrl" name="upstreamUrl" type="url" defaultValue={v?.upstreamUrl ?? defaults.upstreamUrl} placeholder="https://api.example.com/v1" className="field" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Auth header" name="authHeader" error={err.authHeader} optional hint="Added to every upstream call.">
            <input id="authHeader" name="authHeader" defaultValue={v?.authHeader ?? defaults.authHeader} placeholder="X-API-Key" className="field" />
          </Field>
          <Field
            label="Auth secret"
            name="authSecret"
            error={err.authSecret}
            optional
            hint={secretsEnabled ? (secretSet ? "A secret is saved. Leave blank to keep it." : "Encrypted at rest. Never shown again.") : "Not enabled on this deployment."}
          >
            <input
              id="authSecret"
              name="authSecret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={!secretsEnabled}
              className="field"
            />
          </Field>
        </div>
        {secretSet && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="clearSecret" /> Remove the saved secret
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-medium">Price per call</legend>
        <p className="text-sm text-muted">Payments go straight to the wallet you signed in with. Autonomo takes no cut.</p>
        {/* Labels wrap only the checkbox and its title, so clicking near a price never toggles the option. */}
        <div>
          <label className="flex items-center gap-3">
            <input type="checkbox" name="acceptUsdg" checked={acceptUsdg} onChange={(e) => setAcceptUsdg(e.target.checked)} />
            <span className="text-sm font-medium">USDG on Robinhood Chain</span>
          </label>
          <div className="mt-2 ml-7 flex items-center gap-2">
            <span className="font-mono text-sm text-faint">$</span>
            <input
              name="priceUsd"
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
              disabled={!acceptUsdg}
              inputMode="decimal"
              className="field w-32 disabled:opacity-50"
              aria-label="Price in USD"
            />
            <span className="text-sm text-muted">per call</span>
          </div>
          {err.priceUsd && <p className="mt-1 ml-7 text-sm text-warn">{err.priceUsd}</p>}
        </div>
        <div>
          <label className="flex items-center gap-3">
            <input type="checkbox" name="acceptAutonomo" checked={acceptAutonomo} onChange={(e) => setAcceptAutonomo(e.target.checked)} />
            <span className="text-sm font-medium">$AUTONOMO on Robinhood Chain</span>
          </label>
          {acceptAutonomo && (
            <div className="mt-2 ml-7 flex items-center gap-2">
              <input
                name="autonomoAmount"
                value={autonomoAmount}
                onChange={(e) => setAutonomoAmount(e.target.value)}
                inputMode="decimal"
                placeholder="1000"
                className="field w-32"
                aria-label="Price in AUTONOMO"
              />
              <span className="text-sm text-muted">AUTONOMO per call</span>
            </div>
          )}
          {err.autonomoAmount && <p className="mt-1 ml-7 text-sm text-warn">{err.autonomoAmount}</p>}
        </div>
        {err.acceptUsdg && <p className="text-sm text-warn">{err.acceptUsdg}</p>}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button disabled={pending} aria-busy={pending} className="btn-brand inline-flex items-center gap-2 px-5 py-2.5 text-sm">
          {pending && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {pending ? (defaults.id ? "Saving changes…" : "Launching…") : defaults.id ? "Save changes" : "Launch API"}
        </button>
        {pending ? (
          <span className="text-sm text-muted" role="status">
            Checking your API&apos;s URL and saving. This takes a few seconds.
          </span>
        ) : (
          <SavedNotice />
        )}
      </div>
      {!pending && state.errors && Object.keys(state.errors).length > 0 && (
        <p className="text-sm text-warn" role="alert">
          Not saved yet. Fix the highlighted fields above and try again.
        </p>
      )}
    </form>
  );
}

/** Shows "Changes saved" next to the button after a save, then clears the flag from the URL. */
function SavedNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [show, setShow] = useState(params.get("saved") === "1");
  useEffect(() => {
    if (params.get("saved") !== "1") return;
    setShow(true);
    const t = setTimeout(() => {
      setShow(false);
      router.replace(pathname, { scroll: false });
    }, 5000);
    return () => clearTimeout(t);
  }, [params, pathname, router]);
  if (!show) return null;
  return (
    <span className="text-sm font-medium text-accent" role="status">
      ✓ Changes saved. They&apos;re live now.
    </span>
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
