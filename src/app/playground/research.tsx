"use client";

import { useState } from "react";
import type { LaunchCheck, Receipt, Report, ResearchEvent, ResearchStep, Verdict, WalletCheck } from "@/lib/research";

// The Playground's Research mode: paste a token, watch the agent pay each official API that knows something about
// it, and read one report. The server side is /api/research and src/lib/research.ts.

/** The APIs one report pays, in order, for the page to show their prices before anything runs. */
export type ResearchPrice = { step: ResearchStep; api: string; autonomo: string };

type StepState = { state: "waiting" | "running" | "done" | "fail" | "skipped"; detail: string; receipt?: Receipt };

const STEPS: { step: ResearchStep; title: string }[] = [
  { step: "risk", title: "Token Risk" },
  { step: "launch", title: "Tx Explainer: the launch" },
  { step: "creator", title: "Wallet Portfolio: the creator" },
  { step: "holder", title: "Wallet Portfolio: the largest holder" },
  { step: "summary", title: "The agent's summary" },
];

type Run = {
  token: string;
  steps: Record<ResearchStep, StepState>;
  report: Report | null;
  launch: LaunchCheck | null;
  creator: WalletCheck | null;
  holder: WalletCheck | null;
  summary: string | null;
  receipts: Receipt[];
  state: "working" | "done" | "fail";
  error: string;
};

const waitingSteps = () =>
  Object.fromEntries(STEPS.map(({ step }) => [step, { state: "waiting", detail: "" }])) as Record<ResearchStep, StepState>;

const newRun = (token: string): Run => ({
  token,
  steps: waitingSteps(),
  report: null,
  launch: null,
  creator: null,
  holder: null,
  summary: null,
  receipts: [],
  state: "working",
  error: "",
});

function applyEvent(run: Run, e: ResearchEvent): Run {
  switch (e.type) {
    case "step":
      return { ...run, steps: { ...run.steps, [e.step]: { state: e.state, detail: e.detail, receipt: e.receipt } } };
    case "report":
      return { ...run, report: e.report };
    case "launch":
      return { ...run, launch: e.launch };
    case "wallet":
      return e.role === "creator" ? { ...run, creator: e.check } : { ...run, holder: e.check };
    case "summary":
      return { ...run, summary: e.text };
    case "done":
      return { ...run, receipts: e.receipts, state: "done" };
    case "error":
      return { ...stopSteps(run), state: "fail", error: e.message };
    default:
      return run;
  }
}

/** Steps still running when a report ends won't report back, so they show as stopped. */
const stopSteps = (run: Run): Run => ({
  ...run,
  steps: Object.fromEntries(
    Object.entries(run.steps).map(([k, s]) => [k, s.state === "running" ? { ...s, state: "fail", detail: "Stopped before it finished" } : s]),
  ) as Record<ResearchStep, StepState>,
});

/** Sample-mode addresses: the last character picks the story (see src/lib/research-sample.ts). */
const SAMPLES: [string, string][] = [
  ["Risky token", `0x${"1".repeat(40)}`],
  ["High risk, launch check fails", `0x${"1".repeat(39)}8`],
  ["Ordinary token", `0x${"1".repeat(39)}f`],
  ["No launch found", `0x${"0".repeat(40)}`],
];

const VERDICT: Record<Verdict, { label: string; line: string; tone: string }> = {
  okay: { label: "Looks okay", line: "No major red flags in its holders or trading.", tone: "border-line text-ink" },
  careful: { label: "Be careful", line: "Some warning signs. Read them below.", tone: "border-accent text-accent" },
  high: { label: "High risk", line: "Strong warning signs in its holders or trading.", tone: "border-warn text-warn" },
};

const usd = (n: number | null) => {
  if (n === null) return "–";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return "$0";
  return `$${n.toPrecision(3)}`;
};
const pct = (n: number | null) => (n === null ? "–" : `${n.toFixed(1)}%`);
const count = (n: number | null) => (n === null ? "–" : n.toLocaleString("en-US"));
const eth = (n: number | null) => (n === null ? "–" : `${n < 10 ? n.toFixed(3) : n.toFixed(1)} ETH`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const amountOf = (r: Receipt) => Number(r.amount.replace(/,/g, ""));

function age(iso: string | null) {
  if (!iso) return "–";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

export function ResearchPanel({
  freeDaily,
  live,
  sample,
  prices,
  onAsk,
}: {
  freeDaily: number;
  live: boolean;
  /** Local development only: reports are made-up samples and nothing is paid. */
  sample: boolean;
  prices: ResearchPrice[];
  /** Switches to Ask mode with a follow-up about the token ready to send. */
  onAsk: (question: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  /** Top holders checked on request after the report, which the spent total counts too. */
  const [extraPaid, setExtraPaid] = useState<Receipt[]>([]);
  const busy = run?.state === "working";
  const valid = /^0x[0-9a-fA-F]{40}$/.test(draft.trim());
  const most = prices.reduce((sum, p) => sum + Number(p.autonomo.replace(/,/g, "")), 0);

  const update = (change: (r: Run) => Run) => setRun((r) => (r ? change(r) : r));
  const fail = (error: string) => update((r) => (r.state === "working" ? { ...stopSteps(r), state: "fail", error } : r));

  function research(e: React.FormEvent) {
    e.preventDefault();
    if (valid) start(draft.trim());
  }

  async function start(token: string) {
    if (busy) return;
    setDraft(token);
    setRun(newRun(token));
    setExtraPaid([]);
    let connected = false;
    try {
      const res = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample ? { token, sample: true } : { token }) });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        if (typeof body?.freeLeft === "number") setFreeLeft(body.freeLeft);
        fail(body?.error ?? "The report didn't start. Try again in a moment.");
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
          const event = JSON.parse(line) as ResearchEvent;
          if (event.type === "allowance") setFreeLeft(event.freeLeft);
          else update((r) => applyEvent(r, event));
        }
      }
      fail("The connection dropped before the report finished. Any payment it made is still on-chain.");
    } catch {
      fail(connected ? "The connection dropped before the report finished. Any payment it made is still on-chain." : "Couldn't reach Autonomo. Try again.");
    }
  }

  const started = run !== null;
  const paid = run ? [...reportPaid(run), ...extraPaid] : [];
  const spent = paid.reduce((sum, r) => sum + amountOf(r), 0);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
      <section className="min-w-0">
        {!started && (
          <>
            <h1 className="heading text-5xl leading-[0.95] sm:text-8xl lg:text-7xl xl:text-8xl">
              Paste a token.
              <br />
              The agent digs.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              The research agent pays every Autonomo API that knows something about a Robinhood Chain token: its risk, its launch, its
              creator and its largest holder. Then it writes up what it found, with an on-chain receipt for each call.
            </p>
          </>
        )}

        <form onSubmit={research} className={`flex gap-2 rounded-lg border bg-surface p-2 ${started ? "" : "mt-8"} ${busy ? "border-line" : "border-accent"}`}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Token address, 0x…"
            aria-label="Token contract address"
            spellCheck={false}
            autoComplete="off"
            disabled={!live || busy}
            className="min-h-12 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-base placeholder:text-muted sm:text-base"
          />
          <button className="btn-brand inline-flex min-h-12 items-center justify-center gap-2 px-5 sm:px-7" disabled={!live || busy || !valid}>
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-brand border-t-transparent" />}
            {busy ? "Researching" : started ? "Research" : "Research it"}
          </button>
        </form>
        <p className="mt-2.5 font-mono text-xs text-muted">
          {!live
            ? "Reports aren't live right now. Ask the agent instead."
            : sample
              ? "Local preview: sample reports, nothing is paid"
              : freeLeft === null
              ? `${freeDaily} free reports a day, paid for by the agent's wallet`
              : `${freeLeft} of ${freeDaily} free reports left today`}
        </p>

        {sample && (
          <div className="mt-4 rounded-lg border border-dashed border-faint p-4 text-sm">
            <p className="font-medium">Local preview</p>
            <p className="mt-1 text-muted">
              Sample mode: reports use made-up data, and no API, payment or model is called. Any address works; these show each kind
              of report:
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SAMPLES.map(([label, token]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => start(token)}
                  disabled={busy}
                  className="min-h-9 rounded-md border border-line px-3 text-xs hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {run && (
          <div className="mt-8 space-y-6" aria-live="polite">
            <StepList run={run} />
            {run.state === "fail" && (
              <div className="rounded-lg border border-warn/50 bg-surface p-5">
                <p className="font-medium text-warn">{run.report ? "The report stopped early" : "No report"}</p>
                <p className="mt-1 text-sm text-muted">{run.error}</p>
              </div>
            )}
            {run.report && (
              <ReportView
                key={run.report.token}
                run={run}
                report={run.report}
                live={live}
                sample={sample}
                onAsk={onAsk}
                onPaid={(r) => setExtraPaid((all) => [...all, r])}
              />
            )}
          </div>
        )}
      </section>

      <aside className="min-w-0 rounded-lg border border-line bg-surface lg:sticky lg:top-6">
        {started ? (
          <div className="px-4 py-4">
            <p className="font-mono text-xs tracking-[0.1em] text-muted uppercase">This report spent</p>
            <p className="mt-0.5 font-display text-6xl leading-none font-bold text-accent">{spent.toLocaleString("en-US")}</p>
            <p className="mt-1 font-mono text-xs text-muted">
              $AUTONOMO · {paid.length} {paid.length === 1 ? "call" : "calls"} settled
            </p>
          </div>
        ) : (
          <div className="border-b border-line px-4 py-4">
            <h2 className="heading text-2xl">What a report pays for</h2>
            <p className="mt-1 text-sm text-muted">One x402 payment per call, on Robinhood Chain.</p>
          </div>
        )}
        <ul className={`divide-y divide-line ${started ? "border-t border-line" : ""}`}>
          {prices.map((p) => (
            <li key={p.step} className="flex justify-between gap-3 px-4 py-3 text-sm">
              <span>{STEPS.find((s) => s.step === p.step)?.title ?? p.api}</span>
              <span className="font-mono text-xs whitespace-nowrap text-accent">{p.autonomo}</span>
            </li>
          ))}
        </ul>
        {most > 0 && (
          <p className="border-t border-line px-4 py-3 font-mono text-xs text-muted">
            At most {most.toLocaleString("en-US")} $AUTONOMO a report. The summary costs no payment.
          </p>
        )}
      </aside>
    </div>
  );
}

/** What the report itself paid: the final list once done, or each finished step's receipt so far. */
const reportPaid = (run: Run) => (run.state === "done" ? run.receipts : Object.values(run.steps).flatMap((s) => (s.receipt ? [s.receipt] : [])));

function StepList({ run }: { run: Run }) {
  return (
    <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
      {STEPS.map(({ step, title }) => {
        const s = run.steps[step];
        return (
          <li key={step} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${s.state === "running" ? "bg-accent-soft" : ""}`}>
            <StepMark state={s.state} />
            <div className="min-w-44 flex-1">
              <p className={`font-semibold ${s.state === "waiting" || s.state === "skipped" ? "text-muted" : ""}`}>{title}</p>
              {s.detail && <p className="text-sm text-muted">{s.detail}</p>}
            </div>
            {s.receipt && <span className="font-mono text-xs text-accent">{s.receipt.amount} $AUTONOMO</span>}
            {s.receipt?.explorer && s.receipt.tx && (
              <a href={s.receipt.explorer} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent underline">
                tx {short(s.receipt.tx)}
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepMark({ state }: { state: StepState["state"] }) {
  if (state === "done") return <span className="w-5 text-center text-lg text-green-600 dark:text-green-400" aria-label="Done">✓</span>;
  if (state === "fail") return <span className="w-5 text-center text-lg text-warn" aria-label="Stopped">✗</span>;
  if (state === "running") return <span className="h-5 w-5 flex-none animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="Working" />;
  return <span className="w-5 text-center text-lg text-faint" aria-label={state === "skipped" ? "Skipped" : "Waiting"}>–</span>;
}

type Holder = { kind: "idle" } | { kind: "working" } | { kind: "done"; check: WalletCheck; receipt: Receipt } | { kind: "error"; message: string };

function ReportView({
  run,
  report: r,
  live,
  sample,
  onAsk,
  onPaid,
}: {
  run: Run;
  report: Report;
  live: boolean;
  sample: boolean;
  onAsk: (question: string) => void;
  onPaid: (receipt: Receipt) => void;
}) {
  const v = VERDICT[r.verdict];
  const [extra, setExtra] = useState<Record<string, Holder>>({});
  const title = r.symbol ? `$${r.symbol}` : short(r.token);
  const isCreator = (a: string) => !!r.creator && a.toLowerCase() === r.creator.toLowerCase();
  const largest = r.topHolders[0]?.address.toLowerCase();
  const extraPaid = Object.values(extra).flatMap((h) => (h.kind === "done" ? [h.receipt] : []));
  const paid = [...reportPaid(run), ...extraPaid];

  async function checkHolder(wallet: string) {
    const key = wallet.toLowerCase();
    if (extra[key]?.kind === "working") return;
    setExtra((x) => ({ ...x, [key]: { kind: "working" } }));
    try {
      const res = await fetch("/api/research/holder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sample ? { token: r.token, wallet, sample: true } : { token: r.token, wallet }),
      });
      const body = await res.json().catch(() => ({}));
      const next: Holder =
        res.ok && body.check ? { kind: "done", check: body.check, receipt: body.receipt } : { kind: "error", message: body.error ?? "The check didn't finish. Try again in a moment." };
      setExtra((x) => ({ ...x, [key]: next }));
      if (next.kind === "done") onPaid(next.receipt);
    } catch {
      setExtra((x) => ({ ...x, [key]: { kind: "error", message: "Couldn't reach Autonomo. Check your connection and try again." } }));
    }
  }

  const followUp = `What else should I know about ${r.symbol ? `$${r.symbol}` : "this token"} (${r.token})?`;

  return (
    <article className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
        <div className="min-w-0">
          <h2 className="heading text-3xl [overflow-wrap:anywhere]">{title}</h2>
          <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">
            {r.name && r.name !== r.symbol ? `${r.name} · ` : ""}
            <span className="font-mono">{short(r.token)}</span> · launched {age(r.launchedAt)}
          </p>
        </div>
        <div className={`rounded-md border-2 px-4 py-2 text-right ${v.tone}`}>
          <p className="heading text-2xl leading-none">{v.label}</p>
          <p className="mt-1 font-mono text-xs">risk score {r.score}</p>
        </div>
      </header>

      {(run.summary || run.steps.summary.state === "running") && (
        <section className="border-b border-line p-5 sm:p-6">
          <p className="font-mono text-xs tracking-[0.14em] text-accent uppercase">The agent&apos;s read</p>
          {run.summary ? (
            <p className="mt-2 text-lg [overflow-wrap:anywhere]">{run.summary}</p>
          ) : (
            <p className="mt-2 text-muted">Reading the results…</p>
          )}
        </section>
      )}

      <div className="p-5 sm:p-6">
        <p className="text-lg">{v.line}</p>
        {r.flags.length > 0 && (
          <ul className="mt-4 space-y-2">
            {r.flags.map((f) => (
              <li key={f.text} className="flex gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${f.severity === "high" ? "bg-warn" : f.severity === "medium" ? "bg-accent" : "bg-faint"}`}
                />
                <span>
                  {f.text}
                  {(f.severity === "high" || f.severity === "medium") && <span className="sr-only"> ({f.severity})</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
          <Fact label="Price" value={usd(r.priceUsd)} />
          <Fact label="Market cap" value={usd(r.marketCapUsd)} />
          <Fact label="Curve" value={r.graduated ? "Graduated" : r.curvePercent === null ? "–" : `${r.curvePercent.toFixed(0)}% filled`} />
          <Fact label="Volume, all time" value={eth(r.volumeEth)} />
          <Fact label="Holders" value={count(r.holders)} />
          <Fact label="Top 10 hold" value={pct(r.top10Percent)} />
          <Fact label="Largest wallet" value={pct(r.largestPercent)} />
          <Fact label="Creator holds" value={pct(r.creatorPercent)} />
          <Fact label="Buys, 24 h" value={count(r.buys24h)} />
          <Fact label="Sells, 24 h" value={count(r.sells24h)} />
          <Fact label="Buyers, all time" value={count(r.uniqueBuyers)} />
          <Fact label="Still holding" value={count(r.stillHolding)} />
          <Fact label="Launch-block buyers" value={count(r.launchBlockBuyers)} />
          <Fact label="Bought at launch" value={pct(r.launchBlockBuyersPercent)} />
          {r.burnedPercent !== null && r.burnedPercent > 0 && <Fact label="Burned" value={pct(r.burnedPercent)} />}
        </dl>
        <p className="mt-3 text-xs text-faint">Holder shares are of circulating supply; the creator&apos;s is of total supply.</p>
      </div>

      {(run.launch || run.steps.launch.state === "fail") && (
        <section className="border-t border-line p-5 sm:p-6">
          <h3 className="heading text-xl">The launch</h3>
          {run.launch ? (
            <>
              <Flags flags={run.launch.flags} empty="Nobody else bought in the launch transaction." />
              <p className="mt-3 text-sm text-muted [overflow-wrap:anywhere]">{run.launch.summary}</p>
              {run.launch.explorer && (
                <a href={run.launch.explorer} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-muted underline hover:text-ink">
                  Launch transaction on Blockscout
                </a>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">The launch check didn&apos;t finish: {run.steps.launch.detail}</p>
          )}
        </section>
      )}

      {(run.creator || run.steps.creator.state === "fail") && (
        <section className="border-t border-line p-5 sm:p-6">
          <h3 className="heading text-xl">The creator</h3>
          {run.creator ? (
            <WalletView check={run.creator} symbol={r.symbol} />
          ) : (
            <p className="mt-2 text-sm text-muted">The creator check didn&apos;t finish: {run.steps.creator.detail}</p>
          )}
        </section>
      )}

      {(run.holder || run.steps.holder.state === "fail") && (
        <section className="border-t border-line p-5 sm:p-6">
          <h3 className="heading text-xl">The largest holder</h3>
          {run.holder ? (
            <WalletView check={run.holder} symbol={r.symbol} />
          ) : (
            <p className="mt-2 text-sm text-muted">The holder check didn&apos;t finish: {run.steps.holder.detail}</p>
          )}
        </section>
      )}

      {r.topHolders.length > 0 && (
        <section className="border-t border-line p-5 sm:p-6">
          <h3 className="heading text-xl">Top holders</h3>
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {r.topHolders.map((h) => {
              const key = h.address.toLowerCase();
              const covered = isCreator(h.address) || key === largest;
              const state = extra[key] ?? { kind: "idle" };
              return (
                <li key={key} className="px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono">
                      {short(h.address)}
                      {isCreator(h.address) && <span className="ml-2 font-sans text-xs text-muted">the creator</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs">{h.percent.toFixed(1)}%</span>
                      {!covered && state.kind !== "done" && (
                        <button
                          type="button"
                          onClick={() => checkHolder(h.address)}
                          disabled={!live || state.kind === "working" || run.state === "working"}
                          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 text-xs hover:border-accent hover:text-accent disabled:opacity-60"
                        >
                          {state.kind === "working" && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                          {state.kind === "working" ? "Checking…" : "Check this wallet"}
                        </button>
                      )}
                    </span>
                  </div>
                  {state.kind === "done" && <WalletView check={state.check} symbol={r.symbol} />}
                  {state.kind === "error" && <p className="mt-2 text-warn">{state.message}</p>}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-faint">Each check is one more payment to Wallet Portfolio. Free checks are counted apart from reports.</p>
        </section>
      )}

      <footer className="flex flex-wrap items-start justify-between gap-3 border-t border-line px-5 py-4 text-sm text-muted sm:px-6">
        <ul className="space-y-1">
          {paid.map((p, i) => (
            <li key={`${p.tx ?? p.api}-${i}`}>
              Paid {p.amount} $AUTONOMO to {p.api}
              {p.explorer && p.tx && (
                <>
                  {" · "}
                  <a href={p.explorer} target="_blank" rel="noreferrer" className="font-mono underline hover:text-ink">
                    tx {short(p.tx)}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
        <span className="flex flex-wrap gap-4">
          {r.explorer && (
            <a href={r.explorer} target="_blank" rel="noreferrer" className="underline hover:text-ink">
              Token on Blockscout
            </a>
          )}
          {run.state !== "working" && (
            <button type="button" onClick={() => onAsk(followUp)} className="underline hover:text-ink">
              Ask the agent about it
            </button>
          )}
        </span>
      </footer>
      <p className="border-t border-line px-5 py-3 text-xs text-faint sm:px-6">
        A heuristic from public on-chain data, not financial advice. A low score doesn&apos;t make a token safe.
      </p>
    </article>
  );
}

function Flags({ flags, empty }: { flags: string[]; empty: string }) {
  if (!flags.length) return <p className="mt-2 text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-3 space-y-2">
      {flags.map((f) => (
        <li key={f} className="flex gap-2.5 text-sm">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

function WalletView({ check: c, symbol }: { check: WalletCheck; symbol: string | null }) {
  const name = symbol ? `$${symbol}` : "this token";
  return (
    <div className="mt-3">
      <Flags flags={c.flags} empty="Nothing unusual in what this wallet holds." />
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Fact label="Wallet" value={short(c.wallet)} />
        <Fact label="Worth" value={usd(c.totalUsd)} />
        <Fact label={`Holds ${name}`} value={c.holdsThis ? (c.holdsThis.valueUsd !== null ? usd(c.holdsThis.valueUsd) : "Yes") : "None"} />
        <Fact label="Other new launches" value={count(c.launchCount)} />
      </dl>
      {c.launches.length > 0 && (
        <p className="mt-3 text-xs text-muted [overflow-wrap:anywhere]">
          Among them:{" "}
          {c.launches.map((l, i) => (
            <span key={l.token}>
              {i > 0 && ", "}
              <span className="font-mono">{l.symbol ? `$${l.symbol}` : short(l.token)}</span>
              {l.valueUsd !== null && ` (${usd(l.valueUsd)})`}
            </span>
          ))}
        </p>
      )}
      {c.explorer && (
        <a href={c.explorer} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-muted underline hover:text-ink">
          Wallet on Blockscout
        </a>
      )}
      <p className="mt-2 text-xs text-faint">Covers ETH, USDG and $AUTONOMO, plus tokens it received in the last 2 days.</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 font-mono">{value}</dd>
    </div>
  );
}
