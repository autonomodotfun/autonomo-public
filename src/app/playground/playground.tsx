"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlaygroundEvent } from "@/lib/playground-events";
import { networkLabel, normalizeNetwork } from "@/lib/networks";

type StepKey = "search" | "quote" | "pay" | "answer";
type StepState = "idle" | "running" | "done" | "fail" | "soon";
type Step = { state: StepState; detail: string };

const STEPS: { key: StepKey; icon: string; title: string }[] = [
  { key: "search", icon: "🔎", title: "Find a paid API" },
  { key: "quote", icon: "💰", title: "Check the price" },
  { key: "pay", icon: "⚡", title: "Pay in $AUTONOMO" },
  { key: "answer", icon: "💬", title: "Answer with the receipt" },
];

const EXAMPLES = ["What's the current price of $AUTONOMO?", "Weather forecast for Tokyo", "Risk check for a Solana meme coin"];

const blank = (): Record<StepKey, Step> => ({
  search: { state: "idle", detail: "" },
  quote: { state: "idle", detail: "" },
  pay: { state: "idle", detail: "" },
  answer: { state: "idle", detail: "" },
});

type Api = Extract<PlaygroundEvent, { step: "search"; state: "done" }>["api"];
type Quote = Extract<PlaygroundEvent, { step: "quote"; state: "done" }>;

export function Playground() {
  const [question, setQuestion] = useState("");
  const [steps, setSteps] = useState(blank);
  const [api, setApi] = useState<Api | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setQuestion(text);
    setSteps(blank());
    setApi(null);
    setQuote(null);
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Something went wrong. Try again.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) apply(JSON.parse(line) as PlaygroundEvent);
      }
    } catch {
      setError("Couldn't reach the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function apply(e: PlaygroundEvent) {
    if (e.step === "end") return;
    setSteps((s) => ({ ...s, [e.step]: { state: e.state, detail: e.detail } }));
    if (e.step === "search" && e.state === "done") setApi(e.api);
    if (e.step === "quote" && e.state === "done") setQuote(e);
  }

  const started = steps.search.state !== "idle";

  return (
    <div className="mt-8 rounded-lg border border-line bg-surface">
      <form
        className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          placeholder="Ask anything, e.g. What's the current price of $AUTONOMO?"
          className="field flex-1 py-2.5 text-base"
          aria-label="Your question"
        />
        <button className="btn-brand inline-flex items-center justify-center gap-2 px-5 py-2.5" disabled={busy || !question.trim()}>
          {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-brand border-t-transparent" />}
          {busy ? "Working" : "Ask"}
        </button>
      </form>

      {!started && !error && (
        <div className="flex flex-wrap gap-2 p-4">
          <span className="w-full text-sm text-muted">Try one:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => ask(ex)}
              className="rounded-md border border-line px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <p className="p-4 text-sm text-warn">{error}</p>}

      {started && (
        <ol className="divide-y divide-dashed divide-line px-4">
          {STEPS.map(({ key, icon, title }) => {
            const s = steps[key];
            return (
              <li key={key} className={`flex gap-3 py-3.5 ${s.state === "idle" ? "opacity-40" : ""}`}>
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-bg text-base">{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{title}</span>
                    <StateBadge state={s.state} />
                  </div>
                  {s.detail && <p className="mt-0.5 text-sm text-muted">{s.detail}</p>}
                  {key === "search" && api && s.state === "done" && (
                    <div className="mt-2 rounded-md border border-line p-3 text-sm">
                      <Link href={`/projects/${api.slug}`} className="font-semibold hover:text-accent">
                        {api.name}
                      </Link>
                      {api.autonomo && <span className="ml-2 font-mono text-xs text-accent uppercase">Autonomo gateway</span>}
                      {api.description && <p className="mt-1 line-clamp-2 text-muted">{api.description}</p>}
                      <p className="mt-1 truncate font-mono text-xs text-faint">GET {api.url}</p>
                    </div>
                  )}
                  {key === "quote" && quote && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {quote.offers.map((o, i) => (
                        <span
                          key={i}
                          className={`rounded-md border px-2.5 py-1 font-mono text-xs ${o.token === "$AUTONOMO" ? "border-accent text-accent" : "border-line"}`}
                        >
                          {Number(o.amount).toLocaleString("en-US", { maximumFractionDigits: 6 })} {o.token}
                          {o.network && <span className="text-faint"> · {networkLabel(normalizeNetwork(o.network) ?? o.network)}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {started && !busy && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4 text-sm">
          <span className="text-muted">Want your API to be the one the agent picks?</span>
          <Link href="/dashboard" className="btn-brand px-3 py-1.5 text-xs">
            Launch your API
          </Link>
        </div>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: StepState }) {
  if (state === "idle") return null;
  const map: Record<Exclude<StepState, "idle">, [string, string]> = {
    running: ["Working…", "text-muted"],
    done: ["✓ Done", "text-green-600 dark:text-green-400"],
    fail: ["✗ Stopped", "text-warn"],
    soon: ["Coming soon", "text-accent"],
  };
  const [label, cls] = map[state];
  return <span className={`font-mono text-xs uppercase ${cls}`}>{label}</span>;
}
