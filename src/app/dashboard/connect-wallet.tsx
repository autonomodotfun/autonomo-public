"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

function wallet(): Eip1193 | undefined {
  return (globalThis as { ethereum?: Eip1193 }).ethereum;
}

// Sign-In with Ethereum: proves wallet ownership with a free signature (no transaction).
export function ConnectWallet() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const eth = wallet();
    if (!eth) {
      setError("No browser wallet found. Install one such as MetaMask or Rabby, then reload this page.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [account] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chainId = parseInt((await eth.request({ method: "eth_chainId" })) as string, 16);
      const { nonce } = (await fetch("/api/auth/nonce", { cache: "no-store" }).then((r) => r.json())) as { nonce: string };
      const message = createSiweMessage({
        address: getAddress(account),
        chainId,
        domain: location.host,
        nonce,
        uri: location.origin,
        version: "1",
        statement: "Sign in to the Autonomo dashboard. This is free and doesn't send a transaction.",
        issuedAt: new Date(),
      });
      const signature = await eth.request({ method: "personal_sign", params: [message, account] });
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!res.ok) throw new Error("The signature couldn't be verified. Try again.");
      router.refresh();
    } catch (e) {
      const code = (e as { code?: number }).code;
      setError(code === 4001 ? "Signature request was rejected." : e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={connect} disabled={busy} className="btn-brand px-5 py-2.5 text-sm">
        {busy ? "Check your wallet…" : "Connect wallet"}
      </button>
      {error && (
        <p className="mt-3 text-sm text-warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.refresh();
      }}
      className="text-sm text-muted underline hover:text-ink"
    >
      Sign out
    </button>
  );
}
