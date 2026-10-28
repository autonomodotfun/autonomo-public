import "server-only";
import { PrivyClient } from "@privy-io/node";
import { isAddress } from "viem";
import { privyAppId } from "@/lib/privy-config";

// Privy sign-in for the owner dashboard (email, social or wallet login, with an embedded wallet for users who
// don't have one). Privy proves who the user is; we then use one of their Ethereum wallets as the owner address
// and start the same session cookie as Sign-In with Ethereum.
//   NEXT_PUBLIC_PRIVY_APP_ID   public app id (also read by the browser SDK)
//   PRIVY_APP_SECRET           server secret, used to verify tokens and read the user's linked wallets
//   PRIVY_VERIFICATION_KEY     optional; lets tokens be verified without a request to Privy

export function privyEnabled() {
  return Boolean(privyAppId && process.env.PRIVY_APP_SECRET);
}

let client: PrivyClient | undefined;

function privy() {
  client ??= new PrivyClient({
    appId: privyAppId!,
    appSecret: process.env.PRIVY_APP_SECRET!,
    jwtVerificationKey: process.env.PRIVY_VERIFICATION_KEY || undefined,
  });
  return client;
}

type WalletAccount = { type: string; chain_type?: string; address?: string; wallet_client_type?: string };

/**
 * Verifies a Privy access token and returns the address to use as the owner: the user's own external wallet if
 * they linked one, otherwise their Privy embedded wallet. Null when the token is invalid; "pending" when the user
 * is valid but their embedded wallet hasn't been created yet.
 */
export async function ownerFromPrivyToken(accessToken: string): Promise<string | "pending" | null> {
  let userId: string;
  try {
    userId = (await privy().utils().auth().verifyAccessToken(accessToken)).user_id;
  } catch {
    return null;
  }
  const user = await privy().users()._get(userId);
  const wallets = (user.linked_accounts as WalletAccount[]).filter(
    (a) => a.type === "wallet" && a.chain_type === "ethereum" && a.address && isAddress(a.address),
  );
  const external = wallets.find((w) => w.wallet_client_type !== "privy");
  const embedded = wallets.find((w) => w.wallet_client_type === "privy");
  const chosen = external ?? embedded;
  return chosen ? chosen.address!.toLowerCase() : "pending";
}
