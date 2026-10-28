import "server-only";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { ExactEvmScheme as ExactEvmFacilitator } from "@x402/evm/exact/facilitator";
import { createWalletClient, defineChain, http, isAddress, parseUnits, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKEN } from "@/lib/constants";

// x402 payments for Autonomo: the paid ("pro") API tier and hosted gateways share one resource server.
//
// Platform settlement (env):
//   FACILITATOR_PRIVATE_KEY   Gas-only wallet that settles Robinhood Chain payments in-process (USDG via EIP-3009,
//                             $AUTONOMO via Permit2; the token has no EIP-3009/EIP-2612). No hosted facilitator
//                             covers Robinhood Chain. Keep a little ETH on Robinhood Chain in it, nothing else.
//   PRO_USDC_NETWORK + PRO_USDC_FACILITATOR_URL   Optional USDC through a hosted facilitator.
//
// Pro tier (env), paying PRO_PAY_TO:
//   PRO_ACCEPT_USDG=1, PRO_PRICE_USD (USDG and USDC), PRO_AUTONOMO_AMOUNT (whole tokens per call).
// With no pay-to address or no rail configured, the tier is off.

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
  usdc:
    env("PRO_USDC_NETWORK") && env("PRO_USDC_FACILITATOR_URL")
      ? { network: env("PRO_USDC_NETWORK") as Network, facilitatorUrl: env("PRO_USDC_FACILITATOR_URL")! }
      : null,
};

export type Rail = "usdg" | "autonomo" | "usdc";

export type Pricing = {
  priceUsd: string;
  acceptUsdg: boolean;
  autonomoAmount: string | null;
  acceptUsdc?: boolean;
};

export type RailOffer =
  | { kind: "usdg"; network: Network; priceUsd: string; atomic: string }
  | { kind: "autonomo"; network: Network; amount: string; atomic: string }
  | { kind: "usdc"; network: Network; priceUsd: string };

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
  if (platform.usdc && p.acceptUsdc && Number(p.priceUsd) > 0) {
    out.push({ kind: "usdc", network: platform.usdc.network, priceUsd: p.priceUsd });
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
      case "usdc":
        return { ...base, price: `$${o.priceUsd}` };
    }
  });
}

/** Which rail an asset address belongs to (for recording payments). */
export function railForAsset(asset: string | undefined): Rail | null {
  const a = asset?.toLowerCase();
  if (!a) return null;
  if (a === USDG.address.toLowerCase()) return "usdg";
  if (a === TOKEN.address.toLowerCase()) return "autonomo";
  return "usdc";
}

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
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    getSupported: async () => facilitator.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
  };
}

let server: x402ResourceServer | undefined;

/** Shared resource server for every paid route; null when nothing can be settled. */
export function x402Server() {
  if (server) return server;
  if (!platform.robinhood && !platform.usdc) return null;
  const facilitators: FacilitatorClient[] = [];
  if (platform.robinhood) facilitators.push(localFacilitator());
  if (platform.usdc) facilitators.push(new HTTPFacilitatorClient({ url: platform.usdc.facilitatorUrl }));
  const evm = new ExactEvmServer();
  server = new x402ResourceServer(facilitators);
  if (platform.robinhood) server.register(TOKEN.network, evm);
  if (platform.usdc) server.register(platform.usdc.network, evm);
  return server;
}

// ---- Pro tier ----

export type ProConfig = { payTo: `0x${string}`; rails: RailOffer[] };

export const proConfig: ProConfig | null = (() => {
  const payTo = env("PRO_PAY_TO");
  if (!payTo || !isAddress(payTo)) return null;
  const rails = offers({
    priceUsd: env("PRO_PRICE_USD") ?? "0.01",
    acceptUsdg: env("PRO_ACCEPT_USDG") === "1",
    autonomoAmount: env("PRO_AUTONOMO_AMOUNT") ?? null,
    acceptUsdc: true,
  });
  return rails.length ? { payTo, rails } : null;
})();

export function proServer(_config: ProConfig) {
  return x402Server()!;
}

export function proAccepts(config: ProConfig) {
  return acceptsFor(config.payTo, config.rails);
}
