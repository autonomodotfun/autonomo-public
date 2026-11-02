"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MAX_PAID_CALLS, plainAnswer, type AgentEvent, type AgentReceipt } from "@/lib/agent-events";

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
  if (e.type === "fail") return { ...stopCalls(turn), text: "", receipts: e.receipts, state: "fail", failure: e.detail };
  return turn;
}

/** Calls still running when a turn ends won't report back, so they show as stopped rather than disappearing. */
const stopCalls = (turn: Turn): Turn => ({
  ...turn,
  calls: turn.calls.map((c) => (c.state === "quoting" || c.state === "paying" ? { ...c, state: "fail", detail: "Stopped before it finished" } : c)),
});

const amountOf = (r: AgentReceipt) => Number(r.amount.replace(/,/g, ""));
const paidIn = (t: Turn) => (t.state === "working" ? t.calls.flatMap((c) => (c.receipt ? [c.receipt] : [])) : t.receipts);
const shortTx = (tx: string) => `tx ${tx.slice(0, 6)}…${tx.slice(-4)}`;

export function Playground({ apis, freeDaily, paymentsOn }: { apis: AvailableApi[]; freeDaily: number; paymentsOn: boolean }) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const conversationId = useRef<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  // Keep the turn that was just asked in view.
  useEffect(() => {
    if (turns.length) threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length]);

  const updateLast = (change: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), change(all[all.length - 1])]);
  const stop = (failure: string) => updateLast((t) => (t.state === "working" ? { ...stopCalls(t), state: "fail", failure } : t));

  async function ask(q: string) {
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setDraft("");
    setTurns((all) => [...all, blankTurn(question)]);
    setBusy(true);
    let connected = false;
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
      connected = true;
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
          if (e.type === "conversation") {
            conversationId.current = e.id;
            setFreeLeft(e.freeLeft);
          } else {
            updateLast((t) => applyEvent(t, e));
          }
        }
      }
      stop("The connection dropped before the agent finished. Any payment it made is still on-chain.");
    } catch {
      stop(connected ? "The connection dropped before the agent finished. Any payment it made is still on-chain." : "Couldn't reach the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    conversationId.current = null;
    setTurns([]);
  }

  const started = turns.length > 0;
  const paid = turns.flatMap(paidIn);
  const spent = paid.reduce((sum, r) => sum + amountOf(r), 0);
  const current = turns[turns.length - 1];
  const callsNow = busy && current ? current.calls.filter((c) => c.state !== "fail").length : null;
  const freeLabel = freeLeft === null ? `${freeDaily} a day` : `${freeLeft} of ${freeDaily}`;

  const notes = (
    <div className="mt-6 space-y-2 text-sm text-muted">
      {!paymentsOn && <p>In this preview the agent reads live prices but doesn&apos;t pay yet, so it can&apos;t answer with a receipt.</p>}
      <p>
        Questions and answers are kept for about 24 hours for follow-ups and go to our AI provider, so don&apos;t include anything
        private. Answers can be wrong and aren&apos;t financial advice.
      </p>
    </div>
  );

  return (
    <div className={`mx-auto max-w-7xl px-4 sm:px-8 ${started ? "pt-6 lg:pt-8" : "pt-10 lg:pt-14"}`}>
      {started && (
        <div className="-mx-4 mb-5 flex items-center justify-between gap-3 border-y border-line bg-surface px-4 py-2.5 font-mono text-xs sm:-mx-8 sm:px-8 lg:hidden">
          <span>
            <span className="font-medium text-accent">{spent.toLocaleString("en-US")}</span> $AUTONOMO spent
          </span>
          <span className="text-muted">{freeLeft === null ? `${freeDaily} free a day` : `${freeLeft} of ${freeDaily} free left`}</span>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <section className="min-w-0">
          {!started && (
            <>
              <p className="font-mono text-xs tracking-[0.14em] text-accent uppercase">Agent Playground</p>
              <h1 className="heading mt-3 text-5xl leading-[0.95] sm:text-8xl lg:text-7xl xl:text-8xl">
                You ask.
                <br />
                The agent pays.
              </h1>
              <p className="mt-5 max-w-2xl text-lg text-muted">
                Ask about tokens, wallets and transactions on Robinhood Chain. The agent picks the APIs it needs and pays in $AUTONOMO, and
                every paid answer comes with an on-chain receipt. No wallet, no signup.
              </p>
            </>
          )}

          {started && (
            <ol className="space-y-7 divide-y divide-line" aria-live="polite">
              {turns.map((turn, i) => (
                <TurnView key={i} turn={turn} />
              ))}
            </ol>
          )}
          <div ref={threadEnd} />

          <form
            className={`flex gap-2 rounded-lg border bg-surface p-2 ${started ? "sticky bottom-2 mt-7" : "mt-8"} ${busy ? "border-line" : "border-accent"}`}
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_QUESTION_CHARS}
              disabled={busy}
              placeholder={busy ? "The agent is working…" : started ? "Ask a follow-up…" : "Is 0x… safe, and who holds it?"}
              className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted sm:text-lg"
              aria-label="Your question"
            />
            <button className="btn-brand inline-flex min-h-12 items-center justify-center gap-2 px-5 sm:px-7" disabled={busy || draft.trim().length < 3}>
              {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-brand border-t-transparent" />}
              {busy ? "Working" : "Ask"}
            </button>
          </form>

          {!started && (
            <>
              <p className="mt-2.5 font-mono text-xs text-muted">{freeDaily} free questions a day, paid for by the agent&apos;s wallet</p>
              {apis.length > 0 && (
                <>
                  <p className="mt-9 font-mono text-xs tracking-[0.14em] text-muted uppercase">Try one</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {apis.map((a) => (
                      <button
                        key={a.slug}
                        type="button"
                        onClick={() => ask(a.question)}
                        className="min-h-14 rounded-md border border-line bg-surface px-3.5 py-2.5 text-left text-sm [overflow-wrap:anywhere] hover:border-accent hover:text-accent"
                      >
                        {a.question}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {started && !busy && (
            <button type="button" onClick={startOver} className="mt-4 min-h-11 text-sm text-muted underline hover:text-accent lg:hidden">
              Start a new conversation
            </button>
          )}
          {notes}
        </section>

        {!started ? (
          apis.length > 0 && (
            <aside className="min-w-0 rounded-lg border border-line bg-surface">
              <div className="border-b border-line px-4 py-4">
                <h2 className="heading text-2xl">What it can pay for</h2>
                <p className="mt-1 text-sm text-muted">Each call is one x402 payment on Robinhood Chain.</p>
              </div>
              <ul className="divide-y divide-line">
                {apis.map((a) => (
                  <li key={a.slug} className="flex justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/projects/${a.projectSlug}`} className="font-semibold hover:text-accent">
                        {a.name}
                      </Link>
                      {a.description && <p className="line-clamp-2 text-sm text-muted">{a.description}</p>}
                    </div>
                    <span className="font-mono text-xs whitespace-nowrap text-accent">{a.autonomo}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-4 py-3 font-mono text-xs text-muted">Prices in $AUTONOMO, per call</p>
            </aside>
          )
        ) : (
          <aside className="sticky top-6 hidden min-w-0 rounded-lg border border-line bg-surface lg:block">
            <h2 className="heading border-b border-line px-4 py-4 text-2xl">This conversation</h2>
            <div className="px-4 py-4">
              <p className="font-mono text-xs tracking-[0.1em] text-muted uppercase">Spent so far</p>
              <p className="mt-0.5 font-display text-6xl leading-none font-bold text-accent">{spent.toLocaleString("en-US")}</p>
              <p className="mt-1 font-mono text-xs text-muted">
                $AUTONOMO · {paid.length} {paid.length === 1 ? "call" : "calls"} settled
              </p>
            </div>
            {callsNow !== null && (
              <div className="flex justify-between gap-3 border-t border-line px-4 py-3.5">
                <span className="text-sm text-muted">Calls for this question</span>
                <span className="font-mono text-xs">
                  {callsNow} of {MAX_PAID_CALLS} max
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-line px-4 py-3.5">
              <span className="text-sm text-muted">Free questions left today</span>
              <span className="font-mono text-xs">{freeLabel}</span>
            </div>
            <div className="border-t border-line px-4 py-3.5">
              <button
                type="button"
                onClick={startOver}
                disabled={busy}
                className="min-h-11 w-full rounded-md border border-line text-sm hover:border-accent hover:text-accent disabled:opacity-50"
              >
                Start a new conversation
              </button>
            </div>
            <div className="border-t border-line px-4 py-4">
              <p className="font-semibold">Want the agent to pick your API?</p>
              <p className="mt-1 text-sm text-muted">Launch it on Autonomo and accept $AUTONOMO.</p>
              <Link href="/dashboard" className="mt-2 inline-block text-sm text-accent underline">
                Launch your API
              </Link>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const working = turn.state === "working";
  const waiting = working && !turn.calls.length && !turn.text;
  // Once finished, the receipt covers what was paid, so only calls that stopped stay listed.
  const calls = working ? turn.calls : turn.calls.filter((c) => c.state === "fail");
  return (
    <li className="space-y-4 pt-7 first:pt-0">
      <div>
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">You</p>
        <p className="mt-1.5 text-xl font-semibold [overflow-wrap:anywhere]">{turn.question}</p>
      </div>

      <div>
        <p className="font-mono text-xs tracking-[0.14em] text-accent uppercase">Agent</p>
        {waiting && <p className="mt-2 text-muted">Thinking…</p>}

        {calls.length > 0 && (
          <ol className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {calls.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 ${c.state === "quoting" || c.state === "paying" ? "bg-accent-soft" : ""}`}>
                <CallMark state={c.state} />
                <div className="min-w-48 flex-1">
                  <p className="font-semibold">{c.api}</p>
                  <p className="text-sm text-muted">{c.detail}</p>
                </div>
                {c.receipt && <span className="font-mono text-xs text-accent">{c.receipt.amount} $AUTONOMO</span>}
                {c.receipt?.explorer && c.receipt.tx && (
                  <a href={c.receipt.explorer} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent underline">
                    {shortTx(c.receipt.tx)}
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}

        {turn.text && <p className="mt-2 text-lg [overflow-wrap:anywhere] whitespace-pre-line">{plainAnswer(turn.text)}</p>}
        {turn.state === "fail" && <p className="mt-2 text-warn">{turn.failure}</p>}
      </div>

      {!working && turn.receipts.length > 0 && <Receipt receipts={turn.receipts} />}
      {turn.state === "answer" && !turn.receipts.length && <p className="font-mono text-xs text-muted">No payment needed for this one</p>}
    </li>
  );
}

function CallMark({ state }: { state: Call["state"] }) {
  if (state === "done") return <span className="w-5 text-center text-lg text-green-600 dark:text-green-400" aria-label="Paid">✓</span>;
  if (state === "fail") return <span className="w-5 text-center text-lg text-warn" aria-label="Stopped">✗</span>;
  return <span className="h-5 w-5 flex-none animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="Working" />;
}

function Receipt({ receipts }: { receipts: AgentReceipt[] }) {
  const total = receipts.reduce((sum, r) => sum + amountOf(r), 0);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-faint px-4 py-3">
        <span className="rounded-sm bg-brand px-2 py-0.5 font-mono text-xs font-medium tracking-[0.1em] text-on-brand uppercase">Receipt</span>
        <span className="font-mono text-xs text-muted">Robinhood Chain</span>
      </div>
      <ul className="space-y-1.5 px-4 py-3">
        {receipts.map((r, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="min-w-36 flex-1 font-semibold">{r.api}</span>
            {r.explorer && r.tx && (
              <a href={r.explorer} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent underline">
                {shortTx(r.tx)}
              </a>
            )}
            <span className="min-w-10 text-right font-mono text-xs">{r.amount}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between gap-3 border-t border-dashed border-faint px-4 py-3 font-mono text-xs">
        <span className="text-muted uppercase">Total</span>
        <span className="font-medium text-accent">{total.toLocaleString("en-US")} $AUTONOMO</span>
      </div>
    </div>
  );
}
