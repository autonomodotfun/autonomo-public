"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { checkMany, launchMany, type BulkApi, type BulkResult } from "./actions";

const BLANK: BulkApi = { name: "", slug: "", description: "", priceUsd: "0.01", autonomoAmount: "100", path: "" };
const MAX_APIS = 20;

const EXAMPLE = `[
  {
    "name": "Weather Now",
    "slug": "weather-now",
    "description": "Current weather for any city.",
    "usdg": "0.01",
    "autonomo": "100",
    "path": "/weather?city=Paris"
  }
]`;

/** Reads a pasted list. Accepts the list itself, or { address, header, apis }. The key is never part of it. */
function readPaste(raw: string): { apis: BulkApi[]; address?: string; header?: string } | string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return "That isn't a readable list. It should look like the example: square brackets around one block per API.";
  }
  const top = data as { apis?: unknown; address?: unknown; header?: unknown };
  const list = Array.isArray(data) ? data : Array.isArray(top?.apis) ? top.apis : null;
  if (!list || !list.length) return "The list is empty.";
  if (list.length > MAX_APIS) return `That's more than ${MAX_APIS} APIs. Launch them in two goes.`;
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  const apis = (list as Record<string, unknown>[]).map((a) => ({
    name: s(a?.name),
    slug: s(a?.slug ?? a?.paidAddress).toLowerCase(),
    description: s(a?.description),
    priceUsd: s(a?.usdg ?? a?.priceUsd),
    autonomoAmount: s(a?.autonomo ?? a?.autonomoAmount),
    path: s(a?.path),
  }));
  return { apis, address: Array.isArray(data) ? undefined : s(top.address) || undefined, header: Array.isArray(data) ? undefined : s(top.header) || undefined };
}

export function BulkForm({ site, secretsEnabled }: { site: string; secretsEnabled: boolean }) {
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [authSecret, setAuthSecret] = useState("");
  const [apis, setApis] = useState<BulkApi[]>([{ ...BLANK }]);
  const [askListing, setAskListing] = useState(true);
  const [paste, setPaste] = useState("");
  const [pasteNote, setPasteNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [busy, setBusy] = useState<"check" | "launch" | null>(null);
  const [, startTransition] = useTransition();

  const host = (site || "https://autonomo.fun").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const shared = { upstreamUrl, authHeader, authSecret };
  // A result describes the list as it was when checked; any edit makes it stale.
  const edit = (fn: () => void) => {
    fn();
    setResult(null);
  };
  const setApi = (i: number, patch: Partial<BulkApi>) => edit(() => setApis((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a))));

  const run = (kind: "check" | "launch") => {
    setBusy(kind);
    startTransition(async () => {
      try {
        setResult(kind === "check" ? await checkMany(shared, apis) : await launchMany(shared, apis, askListing));
      } catch {
        setResult({ error: "That didn't go through. Check your connection and try again.", apis: [] });
      } finally {
        setBusy(null);
      }
    });
  };

  const usePaste = () => {
    const read = readPaste(paste);
    if (typeof read === "string") return setPasteNote({ ok: false, text: read });
    edit(() => {
      setApis(read.apis);
      if (read.address) setUpstreamUrl(read.address);
      if (read.header) setAuthHeader(read.header);
    });
    setPasteNote({ ok: true, text: `Filled in ${read.apis.length} API${read.apis.length === 1 ? "" : "s"} below. Look them over, then check all.` });
  };

  if (result?.launched) {
    return (
      <div className="rounded-lg border border-accent bg-accent-soft p-5" role="status">
        <h2 className="heading text-2xl">{apis.length === 1 ? "Your API is live" : `Your ${apis.length} APIs are live`}</h2>
        <p className="mt-2 text-sm text-muted">
          Agents can pay for them now.{" "}
          {result.listingAsked
            ? "Each one is waiting for review, and shows in the directory once it's approved."
            : "They are hidden from the directory until you ask to be listed, on each API's page."}
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {apis.map((a) => (
            <li key={a.slug} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-line bg-bg p-3">
              <span>
                <span className="font-medium">{a.name}</span>
                <span className="ml-2 font-mono text-xs text-faint">
                  {host}/x/{a.slug}
                </span>
              </span>
              <Link href={`/dashboard/${a.slug}`} className="underline hover:text-ink">
                Open
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/dashboard" className="btn-brand mt-5 inline-block px-4 py-2 text-sm">
          Your APIs
        </Link>
      </div>
    );
  }

  const problems = result?.apis.filter((a) => a.problems.length).length ?? 0;
  const allPass = Boolean(result && !result.error && result.apis.length === apis.length && problems === 0);

  return (
    <div className="space-y-8">
      <fieldset className="space-y-4">
        <legend className="heading text-xl">1. What they share</legend>
        <p className="text-sm text-muted">
          This is for APIs that live at one address and use one key. APIs at different addresses are launched one at a
          time.
        </p>
        <div>
          <label htmlFor="bulk-url" className="mb-1.5 block text-sm font-medium">
            Your API&apos;s address
          </label>
          <input id="bulk-url" type="url" value={upstreamUrl} onChange={(e) => edit(() => setUpstreamUrl(e.target.value))} placeholder="https://api.example.com/v1" className="field" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bulk-header" className="mb-1.5 block text-sm font-medium">
              Header name <span className="font-normal text-faint">if your API needs a key</span>
            </label>
            <input id="bulk-header" value={authHeader} onChange={(e) => edit(() => setAuthHeader(e.target.value))} placeholder="X-API-Key" className="field" />
          </div>
          <div>
            <label htmlFor="bulk-key" className="mb-1.5 block text-sm font-medium">
              Key
            </label>
            <input
              id="bulk-key"
              type="password"
              autoComplete="off"
              value={authSecret}
              onChange={(e) => edit(() => setAuthSecret(e.target.value))}
              disabled={!secretsEnabled}
              placeholder={secretsEnabled ? "" : "Not enabled on this deployment"}
              className="field disabled:opacity-50"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="heading text-xl">2. Your APIs</legend>
        <details className="rounded-md border border-line p-4 text-sm">
          <summary className="cursor-pointer font-medium">Paste a list instead of typing</summary>
          <p className="mt-3 text-muted">
            One block per API, like this. Leave out <code>usdg</code> or <code>autonomo</code> to not accept that coin. Your
            key is never part of the list: type it in the box above.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-surface p-3 font-mono text-xs">{EXAMPLE}</pre>
          <label htmlFor="bulk-paste" className="mt-3 mb-1.5 block font-medium">
            Your list
          </label>
          <textarea id="bulk-paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} spellCheck={false} className="field font-mono text-xs" />
          <button type="button" onClick={usePaste} disabled={!paste.trim()} className="mt-3 rounded-md border border-line px-4 py-2 font-medium hover:bg-surface disabled:opacity-50">
            Fill in from the list
          </button>
          {pasteNote && (
            <p className={`mt-2 ${pasteNote.ok ? "text-accent" : "text-warn"}`} role={pasteNote.ok ? "status" : "alert"}>
              {pasteNote.text}
            </p>
          )}
        </details>

        <ol className="space-y-4">
          {apis.map((a, i) => {
            const r = result?.apis[i];
            const bad = Boolean(r?.problems.length);
            return (
              <li key={i} className={`rounded-md border p-4 ${bad ? "border-warn" : r ? "border-accent" : "border-line"}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs tracking-wide text-faint uppercase">API {i + 1}</p>
                  {apis.length > 1 && (
                    <button type="button" onClick={() => edit(() => setApis((list) => list.filter((_, j) => j !== i)))} className="text-sm text-muted underline hover:text-ink">
                      Remove
                    </button>
                  )}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">Name</span>
                    <input value={a.name} onChange={(e) => setApi(i, { name: e.target.value })} maxLength={80} className="field" />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">Paid address</span>
                    <span className="flex items-center rounded-md border border-line bg-surface focus-within:outline-2 focus-within:outline-accent">
                      <span className="pl-3 font-mono text-xs text-faint">/x/</span>
                      <input
                        value={a.slug}
                        onChange={(e) => setApi(i, { slug: e.target.value.toLowerCase() })}
                        maxLength={40}
                        placeholder="weather-now"
                        className="min-w-0 flex-1 bg-transparent px-1 py-2 font-mono text-sm outline-none placeholder:text-faint"
                      />
                    </span>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">
                      USDG a call <span className="font-normal text-faint">blank to not accept</span>
                    </span>
                    <input value={a.priceUsd} onChange={(e) => setApi(i, { priceUsd: e.target.value })} inputMode="decimal" placeholder="0.01" className="field" />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">
                      $AUTONOMO a call <span className="font-normal text-faint">blank to not accept</span>
                    </span>
                    <input value={a.autonomoAmount} onChange={(e) => setApi(i, { autonomoAmount: e.target.value })} inputMode="decimal" placeholder="100" className="field" />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1.5 block font-medium">
                      Path to test <span className="font-normal text-faint">what an agent adds after the paid address</span>
                    </span>
                    <input value={a.path} onChange={(e) => setApi(i, { path: e.target.value })} placeholder="/weather?city=Paris" className="field font-mono" />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1.5 block font-medium">
                      Description <span className="font-normal text-faint">how agents find it</span>
                    </span>
                    <textarea value={a.description} onChange={(e) => setApi(i, { description: e.target.value })} rows={2} maxLength={300} className="field" />
                  </label>
                </div>
                {r && (
                  <div className="mt-3 text-sm" role={bad ? "alert" : "status"}>
                    {bad ? (
                      <ul className="list-disc space-y-1 pl-5 text-warn">
                        {r.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-accent">Ready. {r.test?.text}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {apis.length < MAX_APIS && (
          <button type="button" onClick={() => edit(() => setApis((list) => [...list, { ...BLANK }]))} className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-surface">
            Add another API
          </button>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="heading text-xl">3. Check and launch</legend>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={askListing} onChange={(e) => setAskListing(e.target.checked)} className="mt-1" />
          <span>
            <span className="font-medium">Ask for each one to be listed</span>
            <span className="block text-muted">Agents can pay either way. Listed APIs show in the directory once we&apos;ve reviewed them.</span>
          </span>
        </label>
        {result?.error && (
          <p className="rounded-md border border-warn p-3 text-sm text-warn" role="alert">
            {result.error}
          </p>
        )}
        {result && !result.error && (
          <p className={`text-sm ${allPass ? "text-accent" : "text-warn"}`} role="status">
            {allPass
              ? `All ${apis.length === 1 ? "good" : `${apis.length} are ready`}. Nothing is launched until you press the button.`
              : `${problems} of ${apis.length} need${problems === 1 ? "s" : ""} fixing. Nothing launches until all of them pass.`}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => run("check")} disabled={busy !== null} aria-busy={busy === "check"} className="rounded-md border border-line px-5 py-2.5 text-sm font-medium hover:bg-surface disabled:opacity-50">
            {busy === "check" ? "Checking…" : "Check all"}
          </button>
          <button type="button" onClick={() => run("launch")} disabled={busy !== null || !allPass} aria-busy={busy === "launch"} className="btn-brand px-5 py-2.5 text-sm">
            {busy === "launch" ? "Launching…" : apis.length === 1 ? "Launch it" : `Launch all ${apis.length}`}
          </button>
        </div>
        <p className="text-xs text-faint">Checking makes one free call to each API, the way a paid call would reach it.</p>
      </fieldset>
    </div>
  );
}
