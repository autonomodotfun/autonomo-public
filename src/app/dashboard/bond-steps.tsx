"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallets } from "@privy-io/react-auth";
import { formatUnits, parseUnits } from "viem";
import { CopyButton } from "@/components/copy-button";
import { cancelWithdrawCall, depositCalls, requestWithdrawCall, withdrawCall, type BondCall } from "@/lib/bond-rules";
import { TOKEN } from "@/lib/constants";

// The dashboard's bond actions. A Safe (or any wallet that isn't the sign-in wallet) gets the exact transactions to
// send itself. A sign-in wallet that is also the paid wallet can send them from here: the wallet shows each one and
// the owner confirms it there. Nothing is sent by the server.

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
/** Gives the wallet to send from, or throws with what the owner should do. */
type Connect = () => Promise<{ provider: Eip1193; account: string }>;

export type BondStepsProps = {
  bond: string;
  /** The wallet that gets paid, which is the wallet that bonds. */
  payee: string;
  /** In the token's smallest unit. */
  amount: string;
  pendingWithdraw: string;
  withdrawReadyAt: number;
  /** What is missing to reach the minimum, 0 when bonded. */
  short: string;
  cooldownDays: number;
  /** Whether a slash opened before the withdrawal was ready is holding it back. */
  heldBySlash: boolean;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const CHAIN_HEX = `0x${TOKEN.chainId.toString(16)}`;

/** For a paid wallet that can't send from this page: a Safe, or a wallet other than the sign-in wallet. */
export function BondStepsManual(props: BondStepsProps & { safe: boolean }) {
  return <BondSteps {...props} safe={props.safe} />;
}

/** For owners who signed in with a browser wallet that is also the paid wallet. */
export function BondStepsBrowser(props: BondStepsProps) {
  const connect: Connect = async () => {
    const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!eth) throw new Error("No browser wallet found. Open the wallet you signed in with, then try again.");
    const [account] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (account?.toLowerCase() !== props.payee.toLowerCase()) throw new Error(`Switch your wallet to ${short(props.payee)}, the wallet your APIs pay.`);
    return { provider: eth, account };
  };
  return <BondSteps {...props} connect={connect} />;
}

/** For owners who signed in with Privy and are paid at that wallet. */
export function BondStepsPrivy(props: BondStepsProps) {
  const { wallets, ready } = useWallets();
  const connect: Connect = async () => {
    const wallet = ready ? wallets.find((w) => w.address.toLowerCase() === props.payee.toLowerCase()) : undefined;
    if (wallet) return { provider: (await wallet.getEthereumProvider()) as Eip1193, account: wallet.address };
    // Signed in directly with a browser wallet: Privy doesn't hold it, the browser does.
    const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
    const [account] = eth ? ((await eth.request({ method: "eth_requestAccounts" })) as string[]) : [];
    if (!eth || account?.toLowerCase() !== props.payee.toLowerCase()) throw new Error(`Connect ${short(props.payee)}, the wallet your APIs pay, then try again.`);
    return { provider: eth, account };
  };
  return <BondSteps {...props} connect={connect} />;
}

async function onRobinhood(provider: Eip1193) {
  if (((await provider.request({ method: "eth_chainId" })) as string).toLowerCase() === CHAIN_HEX) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: TOKEN.chainName,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [TOKEN.rpcUrl],
          blockExplorerUrls: [TOKEN.explorer],
        },
      ],
    });
  }
}

/** Waits until a transaction is in a block, and throws if it failed. */
async function mined(provider: Eip1193, hash: string) {
  for (let i = 0; i < 90; i++) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("The transaction failed on-chain. Nothing was locked or moved by it.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The transaction is taking long. Check it in your wallet, then reload this page.");
}

/** Whole tokens typed by the owner, as the token's smallest unit. Null when it isn't a positive number. */
function parseTokens(text: string) {
  const clean = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,18})?$/.test(clean)) return null;
  const value = parseUnits(clean, TOKEN.decimals);
  return value > 0n ? value : null;
}

const LOCK = "Approve and lock";

const whole = (atomic: bigint) => formatUnits(atomic, TOKEN.decimals).replace(/\.0+$/, "");
/** The same amount for reading: thousands separators, up to 4 decimals. */
const shown = (atomic: bigint) => Number(formatUnits(atomic, TOKEN.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 });
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

function BondSteps({ bond, payee, amount, pendingWithdraw, withdrawReadyAt, short: shortBy, cooldownDays, heldBySlash, connect, safe }: BondStepsProps & { connect?: Connect; safe?: boolean }) {
  const router = useRouter();
  const locked = BigInt(amount);
  const pending = BigInt(pendingWithdraw);
  const [deposit, setDeposit] = useState(BigInt(shortBy) > 0n ? whole(BigInt(shortBy)) : "");
  const [takeOut, setTakeOut] = useState(locked > 0n ? whole(locked) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Read once when the page loads: the server refreshes it after every action.
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const depositAmount = parseTokens(deposit);
  const takeOutAmount = parseTokens(takeOut);
  const takeOutTooHigh = takeOutAmount !== null && takeOutAmount > locked;
  const ready = pending > 0n && now >= withdrawReadyAt;

  async function send(what: string, calls: BondCall[]) {
    if (!connect) return;
    setBusy(what);
    setError(null);
    setDone(null);
    try {
      const { provider, account } = await connect();
      await onRobinhood(provider);
      for (const call of calls) {
        const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: call.to, data: call.data, value: "0x0" }] })) as string;
        await mined(provider, hash);
      }
      setDone(what);
      if (what === LOCK) setDeposit("");
      router.refresh();
    } catch (e) {
      const code = (e as { code?: number }).code;
      setError(code === 4001 ? "The transaction was rejected in your wallet." : e instanceof Error ? e.message : "The transaction couldn't be sent.");
    } finally {
      setBusy(null);
    }
  }

  const action = (what: string, calls: BondCall[] | null, disabled = false) =>
    connect ? (
      <button onClick={() => calls && send(what, calls)} disabled={disabled || !calls || busy !== null} className="btn-brand mt-3 px-3 py-2 text-sm">
        {busy === what ? "Check your wallet…" : what}
      </button>
    ) : (
      calls && !disabled && <Calls calls={calls} safe={!!safe} payee={payee} />
    );

  return (
    <div className="mt-5 grid gap-5">
      <div>
        <label htmlFor="bondDeposit" className="font-medium">
          {locked > 0n ? "Add to your bond" : "Lock your bond"}
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2 sm:max-w-xl">
          <input
            id="bondDeposit"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder={`Amount in ${TOKEN.symbol}`}
            inputMode="decimal"
            spellCheck={false}
            autoComplete="off"
            className="field min-w-0 flex-1 font-mono"
          />
          <span className="text-muted">{TOKEN.symbol}</span>
        </div>
        {deposit !== "" && depositAmount === null && <p className="mt-1 text-warn">Enter an amount of tokens, such as 460000.</p>}
        {action(LOCK, depositAmount === null ? null : depositCalls(TOKEN.address, bond, depositAmount))}
        {connect && <p className="mt-1 text-xs text-faint">Two transactions: an approval for exactly this amount, then the deposit.</p>}
      </div>

      {locked > 0n && pending === 0n && (
        <details>
          <summary className="cursor-pointer font-medium hover:text-ink">Take your bond out</summary>
          <p className="mt-2 text-muted">
            The amount you ask for stops counting at once, so your APIs can lose the Bonded badge today. You can withdraw it{" "}
            {cooldownDays} days later. Asking again restarts the wait.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:max-w-xl">
            <input
              aria-label={`Amount of ${TOKEN.symbol} to take out`}
              value={takeOut}
              onChange={(e) => setTakeOut(e.target.value)}
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              className="field min-w-0 flex-1 font-mono"
            />
            <span className="text-muted">{TOKEN.symbol}</span>
          </div>
          {takeOutTooHigh && <p className="mt-1 text-warn">That is more than the {shown(locked)} you have locked.</p>}
          {action("Ask to withdraw", takeOutAmount === null || takeOutTooHigh ? null : [requestWithdrawCall(bond, takeOutAmount)])}
        </details>
      )}

      {pending > 0n && (
        <div>
          <p className="font-medium">
            {ready
              ? `${shown(pending)} ${TOKEN.symbol} can be withdrawn now`
              : `${shown(pending)} ${TOKEN.symbol} can be withdrawn from ${day(withdrawReadyAt)}. Until then it doesn't count`}
          </p>
          {heldBySlash && <p className="mt-1 text-warn">A slash opened before the wait ended is holding this withdrawal until it runs, is cancelled or expires.</p>}
          {ready && !heldBySlash && action("Withdraw", [withdrawCall(bond)])}
          <div>{action("Stay bonded", [cancelWithdrawCall(bond)])}</div>
          {!connect && <p className="mt-2 text-xs text-faint">Stay bonded drops the request, and the full amount counts again.</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="text-warn">
          {error}
        </p>
      )}
      {done && <p role="status">Done: {done.toLowerCase()}. The numbers above update in a few seconds.</p>}
    </div>
  );
}

/** The transactions for a wallet that sends them itself, with every value it needs. */
function Calls({ calls, safe, payee }: { calls: BondCall[]; safe: boolean; payee: string }) {
  return (
    <div className="mt-3 rounded-md border border-line bg-surface p-3">
      <p className="text-muted">
        {safe
          ? `In your Safe, open Apps, then Transaction Builder, and add ${calls.length === 1 ? "this transaction" : "these transactions in this order, in one batch"}. Switch on "Custom data" to paste the data.`
          : `Send ${calls.length === 1 ? "this transaction" : "these transactions in this order"} from ${short(payee)}, the wallet your APIs pay.`}
      </p>
      <ol className="mt-3 grid gap-3">
        {calls.map((c, i) => (
          <li key={c.data} className="grid gap-1">
            <p className="font-medium">
              {calls.length > 1 ? `${i + 1}. ` : ""}
              {c.label}
            </p>
            <Value label="To" text={c.to} />
            <Value label="Value" text="0" />
            <Value label="Data" text={c.data} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Value({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-10 shrink-0 text-faint">{label}</span>
      <code className="min-w-0 flex-1 font-mono break-all">{text}</code>
      <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} className="shrink-0 text-muted underline hover:text-ink" />
    </div>
  );
}
