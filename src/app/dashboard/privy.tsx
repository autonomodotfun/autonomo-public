"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { defineChain } from "viem";
import { TOKEN } from "@/lib/constants";

const robinhood = defineChain({
  id: TOKEN.chainId,
  name: TOKEN.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [TOKEN.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: TOKEN.explorer } },
});

export function Providers({ appId, children }: { appId: string; children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google", "twitter", "wallet"],
        appearance: { theme: "dark", accentColor: "#FFCE00", landingHeader: "Sign in to Autonomo", walletChainType: "ethereum-only" },
        // Users who sign in with email or social get a wallet to receive payments in.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: robinhood,
        supportedChains: [robinhood],
      }}
    >
      {children}
    </PrivyProvider>
  );
}

/** Opens Privy's login, then exchanges the Privy session for an Autonomo owner session. */
export function PrivySignIn() {
  const router = useRouter();
  const { ready, authenticated, login, getAccessToken, user } = usePrivy();
  const [status, setStatus] = useState<"idle" | "linking" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ready || !authenticated || started.current) return;
    started.current = true;
    setStatus("linking");
    (async () => {
      // A new embedded wallet can take a moment to appear; retry briefly.
      for (let attempt = 0; attempt < 8; attempt++) {
        const token = await getAccessToken();
        const res = await fetch("/api/auth/privy", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) return router.refresh();
        if (res.status !== 409) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      started.current = false;
      setStatus("error");
      setError("We couldn't finish signing you in. Try again.");
    })();
  }, [ready, authenticated, getAccessToken, router, user?.id]);

  return (
    <div>
      <button
        onClick={() => login()}
        disabled={!ready || status === "linking"}
        className="btn-brand px-5 py-2.5 text-sm"
      >
        {!ready ? "Loading…" : status === "linking" ? "Setting up your account…" : "Sign in"}
      </button>
      <p className="mt-2 text-xs text-faint">Email, Google, X or any wallet. New here? We create a wallet for your earnings.</p>
      {error && (
        <p className="mt-3 text-sm text-warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Signs out of both Privy and the Autonomo session. */
export function PrivySignOut() {
  const router = useRouter();
  const { logout } = usePrivy();
  return (
    <button
      onClick={async () => {
        await Promise.allSettled([logout(), fetch("/api/auth/logout", { method: "POST" })]);
        router.refresh();
      }}
      className="text-sm text-muted underline hover:text-ink"
    >
      Sign out
    </button>
  );
}
