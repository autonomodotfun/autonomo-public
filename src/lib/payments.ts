import "server-only";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { ExactEvmScheme as ExactEvmFacilitator } from "@x402/evm/exact/facilitator";
import { createWalletClient, defineChain, http, parseUnits, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKEN } from "@/lib/constants";

// x402 payments for hosted gateways.
//
// Env:
//   FACILITATOR_PRIVATE_KEY   Gas-only wallet that settles Robinhood Chain payments in-process (USDG via EIP-3009,
//                             $AUTONOMO via Permit2; the token has no EIP-3009/EIP-2612). No hosted facilitator
//                             covers Robinhood Chain. Keep a little ETH on Robinhood Chain in it, nothing else.

const robinhood = defineChain({
  id: 4663,
  name: TOKEN.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

// Global Dollar on Robinhood Chain. version() reverts on-chain; "1" is the EIP-712 version that reproduces the
// contract's DOMAIN_SEPARATOR, which EIP-3009 signatures are checked against.
export const USDG = {
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
  eip712: { name: "Global Dollar", version: "1" },
} as const;

function env(name: string) {
  return process.env[name]?.trim() || undefined;
}

// What this deployment can settle, independent of who gets paid.
export const platform = {
  robinhood: Boolean(env("FACILITATOR_PRIVATE_KEY")),
};

export type Rail = "usdg" | "autonomo";

export type Pricing = {
  priceUsd: string;
  acceptUsdg: boolean;
  autonomoAmount: string | null;
};

export type RailOffer =
  | { kind: "usdg"; network: Network; priceUsd: string; atomic: string }
  | { kind: "autonomo"; network: Network; amount: string; atomic: string };

/** The payment options a price can actually be settled in on this deployment. */
export function offers(p: Pricing): RailOffer[] {
  const out: RailOffer[] = [];
  if (platform.robinhood && p.acceptUsdg && Number(p.priceUsd) > 0) {
    out.push({ kind: "usdg", network: TOKEN.network, priceUsd: p.priceUsd, atomic: parseUnits(p.priceUsd, USDG.decimals).toString() });
  }
  if (platform.robinhood && p.autonomoAmount && Number(p.autonomoAmount) > 0) {
    out.push({
      kind: "autonomo",
      network: TOKEN.network,
      amount: p.autonomoAmount,
      atomic: parseUnits(p.autonomoAmount, TOKEN.decimals).toString(),
    });
  }
  return out;
}

/** x402 `accepts` entries for a set of offers, all paying `payTo`. */
export function acceptsFor(payTo: string, list: RailOffer[]) {
  return list.map((o) => {
    const base = { scheme: "exact", network: o.network, payTo };
    switch (o.kind) {
      case "usdg":
        return { ...base, price: { amount: o.atomic, asset: USDG.address, extra: { ...USDG.eip712 } } };
      case "autonomo":
        return { ...base, price: { amount: o.atomic, asset: TOKEN.address, extra: { assetTransferMethod: "permit2" } } };
    }
  });
}

/** Which rail an asset address belongs to (for recording payments). */
export function railForAsset(asset: string | undefined): Rail | null {
  const a = asset?.toLowerCase();
  if (a === USDG.address.toLowerCase()) return "usdg";
  if (a === TOKEN.address.toLowerCase()) return "autonomo";
  return null;
}

const INSUFFICIENT_BALANCE = new Set(["invalid_exact_evm_insufficient_balance", "permit2_insufficient_balance"]);

// Adapts the in-process facilitator to the FacilitatorClient interface the resource server expects.
function localFacilitator(): FacilitatorClient {
  const account = privateKeyToAccount(env("FACILITATOR_PRIVATE_KEY") as Hex);
  const client = createWalletClient({
    account,
    chain: robinhood,
    transport: http(env("ROBINHOOD_RPC_URL")),
  }).extend(publicActions);
  // Explicit mapping: viem's overloaded method types don't line up with the SDK's signer interface.
  const signer = toFacilitatorEvmSigner({
    address: account.address,
    readContract: (args) => client.readContract({ ...args, args: args.args ?? [] } as never),
    verifyTypedData: (args) => client.verifyTypedData(args as never),
    writeContract: (args) => client.writeContract(args as never),
    sendTransaction: (args) => client.sendTransaction(args),
    waitForTransactionReceipt: (args) => client.waitForTransactionReceipt(args),
    getCode: (args) => client.getCode(args),
  });
  const facilitator = new x402Facilitator().register(TOKEN.network, new ExactEvmFacilitator(signer));
  return {
    // The balance is already read at the latest block, but a payer who just received the money (an agent that
    // borrowed the price a moment before paying) can still look short on an RPC node a block behind. So a payment
    // refused only for its balance is checked once more, 2 seconds later. Nothing is sent before settle, so this is safe.
    verify: async (payload, requirements) => {
      const first = await facilitator.verify(payload, requirements);
      if (first.isValid || !INSUFFICIENT_BALANCE.has(first.invalidReason ?? "")) return first;
      await new Promise((r) => setTimeout(r, 2000));
      return facilitator.verify(payload, requirements);
    },
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    getSupported: async () => facilitator.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
  };
}

let server: x402ResourceServer | undefined;

/** Shared resource server for every paid route; null when nothing can be settled. */
export function x402Server() {
  if (server) return server;
  if (!platform.robinhood) return null;
  server = new x402ResourceServer([localFacilitator()]);
  server.register(TOKEN.network, new ExactEvmServer());
  return server;
}
