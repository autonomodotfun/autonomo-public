"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { UpstreamTest } from "@/lib/gateway";
import { checkLaunchStep, saveGateway, testApi, type GatewayFormState } from "./actions";

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

// What ticking $AUTONOMO starts at, per call. The official APIs charge the same.
const DEFAULT_AUTONOMO = "100";

// A new API is launched in three steps. Editing one shows every field at once.
const STEPS = ["Your API", "Your price", "Review and launch"];
// Which step each field is on, so an error from the server opens the step it belongs to.
const STEP_OF: Record<string, number> = {
  name: 0,
  slug: 0,
  description: 0,
  upstreamUrl: 0,
  authHeader: 0,
  authSecret: 0,
  priceUsd: 1,
  autonomoAmount: 1,
  acceptUsdg: 1,
};

type Errors = Record<string, string | undefined>;

// What each field is called on the form, for the list of problems shown on the review.
const FIELD_LABEL: Record<string, string> = {
  name: "API name",
  slug: "Your paid address",
  description: "What does it do?",
  upstreamUrl: "Your API's address",
  authHeader: "Your API key",
  authSecret: "Your API key",
  priceUsd: "Price per call",
  autonomoAmount: "Price per call",
  acceptUsdg: "Price per call",
};

// The same rules the server applies on save, checked early so a mistake shows on the step it was made.
function checkStep(step: number, f: FormData): Errors {
  const get = (k: string) => String(f.get(k) ?? "").trim();
  const e: Errors = {};
  if (step === 0) {
    if (!get("name")) e.name = "Give your API a name.";
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(get("slug"))) e.slug = "3–40 lowercase letters, numbers or dashes.";
    if (!/^https:\/\/[^\s/]+/.test(get("upstreamUrl"))) e.upstreamUrl = "Enter your API's address, starting with https://";
    const header = get("authHeader");
    if (header && !/^[A-Za-z0-9-]{1,64}$/.test(header)) e.authHeader = "Use a plain header name, like Authorization or X-API-Key.";
    if (get("authSecret") && !header) e.authHeader = "Say which header your API reads the key from.";
  }
  if (step === 1) {
    const usdg = f.get("acceptUsdg") === "on";
    const autonomo = f.get("acceptAutonomo") === "on";
    const price = Number(get("priceUsd"));
    if (usdg && !(/^\d+(\.\d{1,6})?$/.test(get("priceUsd")) && price > 0 && price <= 100)) {
      e.priceUsd = "A USD price between 0.000001 and 100, up to 6 decimals.";
    }
    if (autonomo && (!/^\d+(\.\d{1,18})?$/.test(get("autonomoAmount")) || !(Number(get("autonomoAmount")) > 0))) {
      e.autonomoAmount = "How many $AUTONOMO per call.";
    }
    if (!usdg && !autonomo) e.acceptUsdg = "Accept at least one payment option.";
  }
  return e;
}

/**
 * What a test call means for launching. An answer of any kind passes unless the API refused the call (401, 403) or
 * failed on its own side (5xx): those would fail the same way for a paying agent.
 */
function verdict(t: UpstreamTest): { pass: boolean; text: string } {
  if (!t.ok) return { pass: false, text: t.error };
  if (t.status === 401 || t.status === 403) {
    return { pass: false, text: `Your API answered ${t.status}, which means it refused the call. It probably needs a key: check the header name and key above.` };
  }
  if (t.status >= 500) return { pass: false, text: `Your API answered ${t.status}, which is an error on its side. Fix that first, then test again.` };
  if (t.status >= 400) {
    return { pass: true, text: `Your API answered ${t.status} in ${t.ms} ms. That's fine if this path isn't a real one. Add a path your API serves to see a real answer.` };
  }
  return { pass: true, text: `Your API answered ${t.status} in ${t.ms} ms.` };
}

/** A number without trailing zeros, to 6 decimals: 0.0095, not 0.009500. */
const trim = (n: number) => String(Number(n.toFixed(6)));

export function GatewayForm({
  defaults = EMPTY,
  site,
  secretSet = false,
  secretsEnabled,
  burnPercent,
}: {
  defaults?: GatewayDefaults;
  site: string;
  secretSet?: boolean;
  secretsEnabled: boolean;
  burnPercent?: number;
}) {
  const [state, action, pending] = useActionState<GatewayFormState, FormData>(saveGateway, { ok: false });
  const v = state.values;
  const wizard = !defaults.id;
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [stepErrors, setStepErrors] = useState<Errors>({});
  const [review, setReview] = useState<Record<string, string>>({});
  // What the server refused on the last launch. Cleared once the creator gets past the step again.
  const [launchErrors, setLaunchErrors] = useState<Errors>({});
  const [checking, setChecking] = useState(false);
  // The last test call, and exactly what it was run against, so a changed address or key is tested again.
  const [testPath, setTestPath] = useState("");
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{ sig: string; result: UpstreamTest } | null>(null);
  const err: Errors = { ...(wizard ? launchErrors : (state.errors ?? {})), ...stepErrors };
  const [slug, setSlug] = useState(v?.slug ?? defaults.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(defaults.slug));
  const [acceptAutonomo, setAcceptAutonomo] = useState(v ? v.acceptAutonomo === "on" : Boolean(defaults.autonomoAmount));
  // Controlled so they survive a failed submit: React resets uncontrolled fields after a form action, and the
  // server never sends the secret back.
  const [acceptUsdg, setAcceptUsdg] = useState(v ? v.acceptUsdg === "on" : defaults.acceptUsdg);
  const [priceUsd, setPriceUsd] = useState(v?.priceUsd ?? defaults.priceUsd);
  const [autonomoAmount, setAutonomoAmount] = useState(v?.autonomoAmount || defaults.autonomoAmount || DEFAULT_AUTONOMO);
  const [secret, setSecret] = useState("");

  // The server refused the launch: stay on the review and say why there, with a way back to the step to fix.
  useEffect(() => {
    if (wizard) setLaunchErrors(state.errors ?? {});
  }, [state, wizard]);
  const launchProblems = Object.entries(launchErrors).filter(([, message]) => message);
  const firstProblemStep = Math.min(...launchProblems.map(([k]) => STEP_OF[k] ?? 0));

  async function runTest(data: FormData) {
    const input = {
      upstreamUrl: String(data.get("upstreamUrl") ?? "").trim(),
      path: testPath.trim(),
      authHeader: String(data.get("authHeader") ?? "").trim(),
      authSecret: String(data.get("authSecret") ?? ""),
    };
    const sig = JSON.stringify(input);
    if (tested?.sig === sig) return tested.result;
    setTesting(true);
    let result: UpstreamTest;
    try {
      result = await testApi(input);
    } catch {
      result = { ok: false, error: "The test couldn't run. Try again in a moment." };
    } finally {
      setTesting(false);
    }
    setTested({ sig, result });
    return result;
  }

  async function testNow() {
    const form = formRef.current;
    if (!form || testing || checking) return;
    const data = new FormData(form);
    const errors = checkStep(0, data);
    // Only the address and the key matter for a test; the name can still be empty.
    if (errors.upstreamUrl || errors.authHeader) {
      setStepErrors({ upstreamUrl: errors.upstreamUrl, authHeader: errors.authHeader });
      return;
    }
    setStepErrors({});
    await runTest(data);
  }

  async function go(to: number) {
    const form = formRef.current;
    if (!form || checking || testing) return;
    if (to > step) {
      const data = new FormData(form);
      // Every step before the one being opened has to pass.
      for (let s = step; s < to; s++) {
        const errors = checkStep(s, data);
        if (Object.keys(errors).length) {
          setStepErrors(errors);
          setStep(s);
          return;
        }
        // Leaving step 1: ask the server now whether the paid address is free and the API's address can be reached,
        // so the creator hears about it here and not after the review.
        if (s === 0) {
          setChecking(true);
          let found: Errors = {};
          try {
            found = await checkLaunchStep(String(data.get("slug") ?? ""), String(data.get("upstreamUrl") ?? ""));
          } catch {
            // The check couldn't run. Launching checks the same things again.
          } finally {
            setChecking(false);
          }
          if (Object.keys(found).length) {
            setStepErrors(found);
            setStep(0);
            return;
          }
          // Then one real call, unless this exact address and key were already tested.
          const result = await runTest(data);
          if (!verdict(result).pass) {
            setStepErrors({ test: "Your API has to answer a test call before you can go on." });
            setStep(0);
            return;
          }
        }
      }
      setLaunchErrors({});
      // The key itself is never copied into the review, only whether one was typed.
      if (to === 2) setReview(Object.fromEntries([...data.entries()].map(([k, val]) => [k, k === "authSecret" ? (val ? "set" : "") : String(val).trim()])));
    }
    setStepErrors({});
    setStep(to);
    form.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const shown = (s: number) => (wizard && step !== s ? "hidden" : "space-y-6");
  const paidAddress = `${site}/x/${slug || "your-api"}`;
  const keep = burnPercent ? 100 - burnPercent : 100;

  return (
    <form
      ref={formRef}
      action={action}
      className="scroll-mt-24 space-y-6"
      noValidate
      onKeyDown={(e) => {
        // Enter in a text box moves to the next step. It only launches from the review.
        if (wizard && step < 2 && e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          go(step + 1);
        }
      }}
    >
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      {wizard && (
        <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} className={`flex items-center gap-2 ${i === step ? "font-medium text-ink" : "text-faint"}`}>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-xs ${
                  i === step ? "border-accent text-accent" : i < step ? "border-accent bg-accent-soft text-accent" : "border-line"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      )}

      <div className={shown(0)}>
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

        <Field label="Your paid address" name="slug" error={err.slug} hint={`Agents will call ${paidAddress}/… and pay for each call.`}>
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

        <Field label="What does it do?" name="description" error={err.description} optional hint="Agents read this before they pay.">
          <textarea id="description" name="description" defaultValue={v?.description ?? defaults.description} rows={2} maxLength={300} className="field" />
        </Field>

        <Field
          label="Your API's address"
          name="upstreamUrl"
          error={err.upstreamUrl}
          hint="Where your API lives today. A paid call to /x/your-api/forecast is passed on to <this address>/forecast. It has to start with https."
        >
          <input id="upstreamUrl" name="upstreamUrl" type="url" defaultValue={v?.upstreamUrl ?? defaults.upstreamUrl} placeholder="https://api.example.com/v1" className="field" />
        </Field>

        <fieldset className="space-y-4 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-medium">
            Your API key, if it needs one <span className="font-normal text-faint">(optional)</span>
          </legend>
          <p className="text-sm text-muted">
            If your API only answers with a key, give it to us and we add it to every paid call. Agents never see it. Leave
            both boxes empty if your API needs no key.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Header name" name="authHeader" error={err.authHeader} hint="The header your API reads the key from.">
              <input id="authHeader" name="authHeader" defaultValue={v?.authHeader ?? defaults.authHeader} placeholder="X-API-Key" className="field" />
            </Field>
            <Field
              label="Key"
              name="authSecret"
              error={err.authSecret}
              hint={secretsEnabled ? (secretSet ? "A key is saved. Leave blank to keep it." : "Stored encrypted. Never shown again.") : "Not enabled on this deployment."}
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
              <input type="checkbox" name="clearSecret" /> Remove the saved key
            </label>
          )}
        </fieldset>

        {wizard && (
          <fieldset className="space-y-4 rounded-lg border border-line p-4">
            <legend className="px-1 text-sm font-medium">Test your API</legend>
            <p className="text-sm text-muted">
              We make one free call to your API, the way a paid call would reach it, and show you what comes back. Your
              API has to answer before you can go on.
            </p>
            <div>
              <label htmlFor="testPath" className="mb-1.5 block text-sm font-medium">
                A path to try <span className="font-normal text-faint">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {/* No name: this is only for the test and isn't saved with the API. */}
                <input
                  id="testPath"
                  value={testPath}
                  onChange={(e) => setTestPath(e.target.value)}
                  placeholder="/forecast?city=Lisbon"
                  spellCheck={false}
                  autoComplete="off"
                  className="field min-w-0 flex-1 font-mono"
                />
                <button type="button" onClick={testNow} disabled={testing || checking} aria-busy={testing} className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-surface">
                  {testing ? "Calling your API…" : tested ? "Test again" : "Test my API"}
                </button>
              </div>
              <p className="mt-1 text-xs text-faint">Added to your API&apos;s address. Leave it empty to call the address as it is.</p>
            </div>
            {tested && !testing && (
              <div className={`rounded-md border p-3 text-sm ${verdict(tested.result).pass ? "border-accent bg-accent-soft" : "border-warn"}`} role="status">
                <p className={`font-medium ${verdict(tested.result).pass ? "text-accent" : "text-warn"}`}>{verdict(tested.result).text}</p>
                {tested.result.ok && tested.result.preview && (
                  <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs break-all whitespace-pre-wrap text-muted">{tested.result.preview}</pre>
                )}
              </div>
            )}
            {err.test && <p className="text-sm text-warn" role="alert">{err.test}</p>}
          </fieldset>
        )}
      </div>

      <div className={shown(1)}>
        <fieldset className="space-y-4 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-medium">Price per call</legend>
          <p className="text-sm text-muted">
            Choose what agents can pay with, and what one call costs in each.{" "}
            {burnPercent
              ? `${burnPercent}% of each payment is burned and your wallet gets the other ${keep}%, usually within a day. Autonomo keeps none of it.`
              : "Payments go straight to the wallet you signed in with. Autonomo takes no cut."}
          </p>
          {/* One box per chain. Labels wrap only the checkbox and its title, so clicking near a price never toggles the option. */}
          <div className="space-y-4 rounded-md border border-line p-4">
          <ChainHead name="Robinhood Chain" />
          <div>
            <label className="flex items-center gap-3">
              <input type="checkbox" name="acceptUsdg" checked={acceptUsdg} onChange={(e) => setAcceptUsdg(e.target.checked)} />
              <span className="text-sm font-medium">USDG</span>
              <span className="text-xs text-faint">a dollar stablecoin</span>
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
            {err.priceUsd && <p className="mt-1 ml-7 text-sm text-warn" role="alert">{err.priceUsd}</p>}
          </div>
          <div>
            <label className="flex items-center gap-3">
              <input type="checkbox" name="acceptAutonomo" checked={acceptAutonomo} onChange={(e) => setAcceptAutonomo(e.target.checked)} />
              <span className="text-sm font-medium">$AUTONOMO</span>
              <span className="text-xs text-faint">our token</span>
            </label>
            {acceptAutonomo && (
              <div className="mt-2 ml-7 flex items-center gap-2">
                <input
                  name="autonomoAmount"
                  value={autonomoAmount}
                  onChange={(e) => setAutonomoAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder={DEFAULT_AUTONOMO}
                  className="field w-32"
                  aria-label="Price in AUTONOMO"
                />
                <span className="text-sm text-muted">AUTONOMO per call</span>
              </div>
            )}
            {err.autonomoAmount && <p className="mt-1 ml-7 text-sm text-warn" role="alert">{err.autonomoAmount}</p>}
          </div>
          {err.acceptUsdg && <p className="text-sm text-warn" role="alert">{err.acceptUsdg}</p>}
          </div>

        </fieldset>
      </div>

      {wizard && (
        <div className={shown(2)}>
          {!pending && launchProblems.length > 0 && (
            <div className="rounded-lg border border-warn p-4 text-sm" role="alert">
              <p className="font-medium text-warn">Not launched yet. {launchProblems.length === 1 ? "One thing needs fixing:" : "A few things need fixing:"}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {launchProblems.map(([field, message]) => (
                  <li key={field}>
                    <span className="text-ink">{FIELD_LABEL[field] ?? field}:</span> {message}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => go(firstProblemStep)} className="mt-3 rounded-md border border-line px-3 py-1.5 hover:bg-surface">
                Go back and fix {launchProblems.length === 1 ? "it" : "them"}
              </button>
            </div>
          )}
          <dl className="divide-y divide-line rounded-lg border border-line text-sm">
            <Row label="API name" value={review.name} />
            <Row label="Your paid address" value={paidAddress} mono />
            {review.description && <Row label="What it does" value={review.description} />}
            <Row label="Your API's address" value={review.upstreamUrl} mono />
            <Row
              label="API key"
              value={review.authHeader ? `Sent in the ${review.authHeader} header${review.authSecret ? "" : ", with no key entered"}` : "None. Your API needs no key."}
            />
            <Row
              label="Price per call"
              value={`${[review.acceptUsdg === "on" && `$${review.priceUsd} in USDG`, review.acceptAutonomo === "on" && `${review.autonomoAmount} $AUTONOMO`]
                .filter(Boolean)
                .join(", or ")}, on Robinhood Chain`}
            />
            {tested && <Row label="Test call" value={verdict(tested.result).text} />}
            {review.acceptUsdg === "on" && burnPercent ? (
              <Row
                label="What you keep"
                value={`$${trim((Number(review.priceUsd) * keep) / 100)} of each $${review.priceUsd} call. The other ${burnPercent}% is burned.`}
              />
            ) : null}
          </dl>
          <p className="text-sm text-muted">
            Launching checks that your API&apos;s address answers, then switches your paid address on. Your API starts
            hidden: it works for anyone who has the address, and you can ask to be listed afterwards. You can change
            everything here later.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {wizard && step > 0 && (
          <button type="button" onClick={() => go(step - 1)} disabled={pending} className="rounded-md border border-line px-5 py-2.5 text-sm hover:bg-surface">
            Back
          </button>
        )}
        {wizard && step < 2 ? (
          <button type="button" onClick={() => go(step + 1)} disabled={checking || testing} aria-busy={checking || testing} className="btn-brand px-5 py-2.5 text-sm">
            {checking ? "Checking your API's address…" : testing ? "Calling your API…" : step === 0 ? "Next: your price" : "Next: review"}
          </button>
        ) : (
          <button disabled={pending} aria-busy={pending} className="btn-brand inline-flex items-center gap-2 px-5 py-2.5 text-sm">
            {pending && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {pending ? (defaults.id ? "Saving changes…" : "Launching…") : defaults.id ? "Save changes" : "Launch API"}
          </button>
        )}
        {pending ? (
          <span className="text-sm text-muted" role="status">
            Checking your API&apos;s address and saving. This takes a few seconds.
          </span>
        ) : (
          <SavedNotice />
        )}
      </div>
      {!pending && Object.keys(err).length > 0 && !(wizard && step === 2) && (
        <p className="text-sm text-warn" role="alert">
          {wizard ? "Fix the highlighted fields above to continue." : "Not saved yet. Fix the highlighted fields above and try again."}
        </p>
      )}
    </form>
  );
}

/** A chain's name over its payment options. Each chain gets its own box, so another can be added below. */
function ChainHead({ name }: { name: string }) {
  return <p className="font-mono text-xs tracking-wide text-ink uppercase">{name}</p>;
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 p-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all sm:pt-0.5" : "break-words"}>{value || "—"}</dd>
    </div>
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
