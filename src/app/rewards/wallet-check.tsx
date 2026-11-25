"use client";

import { useState } from "react";
import type { WalletRewards } from "@/lib/rewards/rewards";

const whole = (n: number) => n.toLocaleString("en-US");

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; data: WalletRewards };

/**
 * "Check a wallet" on /rewards: what a wallet holds against the two minimums, its ref code, and its counted calls
 * this month. It shows counts and never an amount of tokens, since a month's amounts are only known at its end.
 */
export function WalletCheck({ symbol, minPayers, minCalls }: { symbol: string; minPayers: number; minCalls: number }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function check(form: FormData) {
    const address = String(form.get("address") ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setState({ status: "error", message: "That isn't a wallet address. It starts with 0x and has 40 more characters." });
      return;
    }
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/v1/rewards/wallet?address=${address}`);
      if (!res.ok) throw new Error(String(res.status));
      setState({ status: "done", data: (await res.json()) as WalletRewards });
    } catch {
      setState({ status: "error", message: "That wallet couldn't be checked just now. Try again in a moment." });
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line p-5 text-sm">
      {/* Submitted by hand, not as a form action, so the address stays in the box after a check. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void check(new FormData(e.currentTarget));
        }}
        className="grid gap-2 sm:max-w-xl"
      >
        <label htmlFor="rewards-wallet" className="font-medium">
          Wallet address
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="rewards-wallet"
            name="address"
            required
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            className="field min-w-0 flex-1 font-mono"
          />
          <button className="btn-brand px-3 py-2" disabled={state.status === "loading"}>
            {state.status === "loading" ? "Checking…" : "Check"}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {state.status === "error" && <p className="mt-4 rounded-md border border-warn p-3 text-warn">{state.message}</p>}
        {state.status === "done" && <Result data={state.data} symbol={symbol} minPayers={minPayers} minCalls={minCalls} />}
      </div>
    </div>
  );
}

function Result({ data, symbol, minPayers, minCalls }: { data: WalletRewards; symbol: string; minPayers: number; minCalls: number }) {
  const { minimums: mins, counts, window } = data;
  const yesNo = (v: boolean | null) => (v === null ? "Couldn't be read" : v ? "Yes" : "No");
  return (
    <div className="mt-5">
      <p className="font-mono text-xs break-all text-muted">{data.wallet}</p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <Fact label={`Holds on Robinhood Chain`} value={data.holds === null ? "Couldn't be read" : `${whole(data.holds)} ${symbol}`} />
        <Fact label="Agent Pass" value={yesNo(data.hasPass)} note={mins ? `Needs ${whole(mins.passTokens)} ${symbol} this week` : undefined} />
        <Fact label="Ref code" value={data.refCode ?? "None"} note={data.refCode && mins ? `Paid with ${whole(mins.integratorTokens)} ${symbol} held: ${yesNo(data.meetsIntegratorMinimum).toLowerCase()}` : undefined} />
      </dl>

      {!window.started ? (
        <p className="mt-4 text-muted">Calls count from December 1, 2026, so there is nothing to show for this month yet.</p>
      ) : (
        <>
          <p className="mt-5 font-medium">Counted this month so far</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            <li>
              Paid {whole(counts.paid.officialCalls)} call{counts.paid.officialCalls === 1 ? "" : "s"} to Autonomo&apos;s own APIs,{" "}
              {whole(counts.paid.withPass)} of them while holding the Agent Pass. Only those earn cashback.
            </li>
            {counts.brought && (
              <li>
                Brought {whole(counts.brought.calls)} call{counts.brought.calls === 1 ? "" : "s"} with its ref code, from{" "}
                {whole(counts.brought.payers)} other wallet{counts.brought.payers === 1 ? "" : "s"}. A month needs {minPayers}.
              </li>
            )}
            {counts.earned && (
              <li>
                Its own APIs were paid for {whole(counts.earned.calls)} call{counts.earned.calls === 1 ? "" : "s"} by{" "}
                {whole(counts.earned.payers)} outside wallet{counts.earned.payers === 1 ? "" : "s"}. A month needs {minCalls} calls from{" "}
                {minPayers} wallets.
              </li>
            )}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs text-faint">
        These are counts, not amounts. What a month pays is worked out on the 1st of the next month, after wallets that belong
        together are taken out.
      </p>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm break-all">{value}</dd>
      {note && <dd className="mt-1 text-xs text-muted">{note}</dd>}
    </div>
  );
}
