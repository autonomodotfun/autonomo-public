"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useWallets } from "@privy-io/react-auth";
import { prepareFirstSafe, setFirstSafe, type FirstSafeState } from "./actions";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type Sign = (message: string) => Promise<string>;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** First Safe for owners who signed in with a browser wallet (Sign-In with Ethereum). */
export function FirstSafeBrowser({ owner }: { owner: string }) {
  const sign: Sign = async (message) => {
    const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!eth) throw new Error("No browser wallet found. Open the wallet you signed in with, then try again.");
    const [account] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (account?.toLowerCase() !== owner) throw new Error(`Switch your wallet to ${short(owner)}, the one you signed in with.`);
    return (await eth.request({ method: "personal_sign", params: [message, account] })) as string;
  };
  return <FirstSafeForm owner={owner} sign={sign} />;
}

/** First Safe for owners who signed in with Privy: signs with whichever of their wallets is the sign-in wallet. */
export function FirstSafePrivy({ owner }: { owner: string }) {
  const { wallets, ready } = useWallets();
  const sign: Sign = async (message) => {
    const wallet = wallets.find((w) => w.address.toLowerCase() === owner);
    if (!ready || !wallet) throw new Error(`Connect ${short(owner)}, the wallet you signed in with, then try again.`);
    const provider = await wallet.getEthereumProvider();
    return (await provider.request({ method: "personal_sign", params: [message, wallet.address] })) as string;
  };
  return <FirstSafeForm owner={owner} sign={sign} />;
}

function FirstSafeForm({ owner, sign }: { owner: string; sign: Sign }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [state, setState] = useState<FirstSafeState>({});
  const [checking, startCheck] = useTransition();
  const [signing, setSigning] = useState(false);

  function check(e: React.FormEvent) {
    e.preventDefault();
    startCheck(async () => setState(await prepareFirstSafe(address)));
  }

  async function confirm() {
    if (!state.message || !state.token) return;
    setSigning(true);
    setState({ ...state, error: undefined });
    try {
      const signature = await sign(state.message);
      const result = await setFirstSafe(state.token, signature);
      if (result.error) setState({ ...state, error: result.error });
      else router.refresh();
    } catch (e) {
      const code = (e as { code?: number }).code;
      setState({ ...state, error: code === 4001 ? "The signature request was rejected." : e instanceof Error ? e.message : "Signing failed." });
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="mt-4 grid gap-2 sm:max-w-xl">
      <form onSubmit={check} className="grid gap-2">
        <label htmlFor="firstSafe" className="font-medium">
          Get paid at a Safe
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="firstSafe"
            required
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              if (state.safe || state.error) setState({});
            }}
            placeholder="0x… Safe address on Robinhood Chain"
            spellCheck={false}
            autoComplete="off"
            className="field min-w-0 flex-1 font-mono"
          />
          <button disabled={checking} className={state.safe ? "rounded-md border border-line px-3 py-2" : "btn-brand px-3 py-2"}>
            {checking ? "Checking…" : "Check Safe"}
          </button>
        </div>
      </form>

      {state.safe && (
        <div className="rounded-md border border-accent bg-accent-soft p-3">
          <p className="font-medium text-accent">
            Safe {state.safe.version}, {state.safe.threshold} of {state.safe.owners.length} signers
          </p>
          <ul className="mt-1 grid gap-0.5 font-mono text-xs break-all text-muted">
            {state.safe.owners.map((o) => (
              <li key={o}>
                {o}
                {o === owner && <span className="font-sans text-ink"> (your sign-in wallet)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted">
            Make sure these are your wallets. Then sign with your sign-in wallet to point all your APIs at this Safe. It&apos;s
            free and doesn&apos;t send a transaction. After this, changing it needs our approval.
          </p>
          <button onClick={confirm} disabled={signing} className="btn-brand mt-3 px-3 py-2">
            {signing ? "Check your wallet…" : "Sign and set Safe"}
          </button>
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-warn">
          {state.error}
        </p>
      )}
      <p className="text-xs text-faint">Payments already made stay where they went.</p>
    </div>
  );
}
