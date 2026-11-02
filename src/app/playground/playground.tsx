"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { plainAnswer, type AgentEvent, type AgentReceipt } from "@/lib/agent-events";

/** A listed Autonomo gateway the agent can pay in $AUTONOMO, with a question that uses it. */
export type AvailableApi = {
  slug: string;
  projectSlug: string;
  name: string;
  description: string;
  autonomo: string;
  usdg: string | null;
  question: string;
};

const MAX_QUESTION_CHARS = 500;

type Call = { id: string; api: string; state: "quoting" | "paying" | "fail" | "done"; detail: string; receipt: AgentReceipt | null };

type Turn = {
  question: string;
  calls: Call[];
  text: string;
  receipts: AgentReceipt[];
  state: "working" | "answer" | "fail";
  failure: string;
};

const blankTurn = (question: string): Turn => ({ question, calls: [], text: "", receipts: [], state: "working", failure: "" });

function applyEvent(turn: Turn, e: AgentEvent): Turn {
  if (e.type === "call") {
    const call: Call = { id: e.id, api: e.api, state: e.state, detail: e.detail, receipt: e.state === "done" ? e.receipt : null };
    const known = turn.calls.some((c) => c.id === e.id);
    return {
      ...turn,
      // Anything the model wrote before calling an API was only a lead-up to the answer.
      text: known ? turn.text : "",
      calls: known ? turn.calls.map((c) => (c.id === e.id ? call : c)) : [...turn.calls, call],
    };
  }
  if (e.type === "text") return { ...turn, text: turn.text + e.delta };
  if (e.type === "retract") return { ...turn, text: "" };
  if (e.type === "answer") return { ...turn, text: e.text, receipts: e.receipts, state: "answer" };
  if (e.type === "fail") return { ...turn, text: "", receipts: e.receipts, state: "fail", failure: e.detail };
  return turn;
}

export function Playground({ apis }: { apis: AvailableApi[] }) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  // Keep the turn that was just asked in view.
  useEffect(() => {
    if (turns.length) threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length]);

  const updateLast = (change: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), change(all[all.length - 1])]);
  const stop = (failure: string) => updateLast((t) => (t.state === "working" ? { ...t, state: "fail", failure } : t));

  async function ask(q: string) {
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setDraft("");
    setTurns((all) => [...all, blankTurn(question)]);
    setBusy(true);
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, conversationId: conversationId.current }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        stop(body?.error ?? "Something went wrong. Try again.");
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
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AgentEvent;
          if (e.type === "conversation") conversationId.current = e.id;
          else updateLast((t) => applyEvent(t, e));
        }
      }
      stop("The connection dropped before the agent finished. Any payment it made is still on-chain.");
    } catch {
      stop("Couldn't reach the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    conversationId.current = null;
    setTurns([]);
  }

  const started = turns.length > 0;

  return (
    <>
      <div className="mt-8 rounded-lg border border-line bg-surface">
        {started && (
          <ol className="divide-y divide-line" aria-live="polite">
            {turns.map((turn, i) => (
              <TurnView key={i} turn={turn} />
            ))}
          </ol>
        )}
        <div ref={threadEnd} />

        {!started && apis.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-line p-4">
            <span className="w-full text-sm text-muted">Try one:</span>
            {apis.map((a) => (
              <button
                key={a.slug}
                type="button"
                onClick={() => ask(a.question)}
                className="rounded-md border border-line px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent"
              >
                {a.question}
              </button>
            ))}
          </div>
        )}

        <form
          className={`flex flex-col gap-2 p-4 sm:flex-row ${started ? "border-t border-line" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_QUESTION_CHARS}
            placeholder={started ? "Ask a follow-up…" : "Ask anything, e.g. Is 0x… safe, and who holds it?"}
            className="field flex-1 py-2.5 text-base"
            aria-label="Your question"
          />
          <button className="btn-brand inline-flex items-center justify-center gap-2 px-5 py-2.5" disabled={busy || draft.trim().length < 3}>
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-brand border-t-transparent" />}
            {busy ? "Working" : "Ask"}
          </button>
        </form>

        {started && !busy && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4 text-sm">
            <button type="button" onClick={startOver} className="text-muted underline hover:text-accent">
              Start a new conversation
            </button>
            <Link href="/dashboard" className="btn-brand px-3 py-1.5 text-xs">
              Launch your API
            </Link>
          </div>
        )}
      </div>

      {apis.length > 0 && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="heading text-2xl">APIs the agent can use right now</h2>
            <span className="font-mono text-xs text-muted uppercase">{apis.length} live · paid in $AUTONOMO</span>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {apis.map((a) => (
              <li key={a.slug} className="flex flex-col rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/projects/${a.projectSlug}`} className="font-semibold hover:text-accent">
                    {a.name}
                  </Link>
                  <span className="font-mono text-[11px] tracking-wider text-accent uppercase">Live</span>
                </div>
                {a.description && <p className="mt-1 line-clamp-3 text-sm text-muted">{a.description}</p>}
                <div className="mt-3 flex flex-wrap gap-2 font-mono text-xs">
                  <span className="rounded-md border border-accent px-2 py-0.5 text-accent">{a.autonomo} $AUTONOMO</span>
                  {a.usdg && <span className="rounded-md border border-line px-2 py-0.5">{a.usdg} USDG</span>}
                  <span className="truncate rounded-md border border-line px-2 py-0.5 text-faint">/x/{a.slug}</span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    ask(a.question);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="mt-4 self-start rounded-md border border-line px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  Ask: “{a.question}”
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            Built an API? <Link href="/dashboard" className="text-accent underline">Launch it on Autonomo</Link>, accept $AUTONOMO and the agent can pick it too.
          </p>
        </section>
      )}
    </>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const waiting = turn.state === "working" && !turn.calls.length && !turn.text;
  return (
    <li className="space-y-3 p-4">
      <p className="font-semibold break-words">{turn.question}</p>

      {waiting && <p className="text-sm text-muted">Thinking…</p>}

      {turn.calls.length > 0 && (
        <ul className="space-y-1.5">
          {turn.calls.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-bg px-3 py-2 text-sm">
              <CallMark state={c.state} />
              <span className="font-semibold">{c.api}</span>
              <span className="min-w-0 text-muted">{c.detail}</span>
              {c.receipt?.explorer && (
                <a href={c.receipt.explorer} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent underline">
                  view tx
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {turn.text && <p className="break-words whitespace-pre-line">{plainAnswer(turn.text)}</p>}
      {turn.state === "fail" && <p className="text-sm text-warn">{turn.failure}</p>}
      {turn.state !== "working" && turn.receipts.length > 0 && <Receipt receipts={turn.receipts} />}
    </li>
  );
}

function CallMark({ state }: { state: Call["state"] }) {
  if (state === "done") return <span className="text-green-600 dark:text-green-400" aria-label="Done">✓</span>;
  if (state === "fail") return <span className="text-warn" aria-label="Stopped">✗</span>;
  return <span className="h-3 w-3 animate-spin self-center rounded-full border-2 border-muted border-t-transparent" aria-label="Working" />;
}

function Receipt({ receipts }: { receipts: AgentReceipt[] }) {
  const total = receipts.reduce((sum, r) => sum + Number(r.amount.replace(/,/g, "")), 0);
  return (
    <p className="font-mono text-xs text-muted">
      <span className="mr-2 rounded-sm bg-brand px-1.5 py-0.5 text-on-brand">Receipt</span>
      Paid {total.toLocaleString("en-US")} $AUTONOMO · {receipts.length} {receipts.length === 1 ? "call" : "calls"} · Robinhood Chain
    </p>
  );
}
