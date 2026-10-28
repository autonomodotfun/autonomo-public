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

// Paid ("pro") API tier, paid per call with x402. Independent payment rails, each enabled by env:
//
//   USDG        PRO_ACCEPT_USDG=1, priced at PRO_PRICE_USD, on Robinhood Chain via EIP-3009.
//   $AUTONOMO   PRO_AUTONOMO_AMOUNT whole tokens per call on Robinhood Chain, paid with Permit2 (the token has
//               no EIP-3009/EIP-2612).
//   USDC        PRO_USDC_NETWORK (e.g. eip155:8453) + PRO_USDC_FACILITATOR_URL, priced at PRO_PRICE_USD.
//
// No hosted facilitator covers Robinhood Chain, so the USDG and $AUTONOMO rails are settled by this server with
// FACILITATOR_PRIVATE_KEY, a gas-only wallet that needs a little ETH on Robinhood Chain.
// All rails pay PRO_PAY_TO. With no pay-to address or no rail configured, the tier is off.

const ROBINHOOD_CHAIN_ID = 4663;

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: TOKEN.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

// Global Dollar on Robinhood Chain. version() reverts on-chain; "1" is the EIP-712 version that reproduces the
// contract's DOMAIN_SEPARATOR, which EIP-3009 signatures are checked against.
const USDG = {
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
  eip712: { name: "Global Dollar", version: "1" },
} as const;

export type ProRail =
  | { kind: "usdg"; network: Network; priceUsd: string; atomic: string }
  | { kind: "autonomo"; network: Network; amount: string; atomic: string }
  | { kind: "usdc"; network: Network; priceUsd: string; facilitatorUrl: string };

export type ProConfig = { payTo: `0x${string}`; rails: ProRail[] };

function env(name: string) {
  return process.env[name]?.trim() || undefined;
}

// Read once per process; returns null when the tier is not configured.
export const proConfig: ProConfig | null = (() => {
  const payTo = env("PRO_PAY_TO");
  if (!payTo || !isAddress(payTo)) return null;
  const rails: ProRail[] = [];
  const priceUsd = env("PRO_PRICE_USD") ?? "0.01";
  const canSettleRobinhood = Boolean(env("FACILITATOR_PRIVATE_KEY"));

  if (env("PRO_ACCEPT_USDG") === "1" && canSettleRobinhood) {
    rails.push({ kind: "usdg", network: TOKEN.network, priceUsd, atomic: parseUnits(priceUsd, USDG.decimals).toString() });
  }

  const tokens = env("PRO_AUTONOMO_AMOUNT");
  if (tokens && canSettleRobinhood && Number(tokens) > 0) {
    rails.push({
      kind: "autonomo",
      network: TOKEN.network,
      amount: tokens,
      atomic: parseUnits(tokens, TOKEN.decimals).toString(),
    });
  }

  const usdcNetwork = env("PRO_USDC_NETWORK");
  const usdcFacilitator = env("PRO_USDC_FACILITATOR_URL");
  if (usdcNetwork && usdcFacilitator) {
    rails.push({
      kind: "usdc",
      network: usdcNetwork as Network,
      priceUsd,
      facilitatorUrl: usdcFacilitator,
    });
  }

  return rails.length ? { payTo, rails } : null;
})();

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

export function proServer(config: ProConfig) {
  if (server) return server;
  // One in-process facilitator covers every Robinhood Chain rail; USDC uses its hosted facilitator.
  const facilitators: FacilitatorClient[] = [];
  if (config.rails.some((r) => r.kind !== "usdc")) facilitators.push(localFacilitator());
  for (const rail of config.rails) {
    if (rail.kind === "usdc") facilitators.push(new HTTPFacilitatorClient({ url: rail.facilitatorUrl }));
  }
  const evm = new ExactEvmServer();
  server = new x402ResourceServer(facilitators);
  for (const network of new Set(config.rails.map((r) => r.network))) server.register(network, evm);
  return server;
}

// The `accepts` list for a paid route: one entry per enabled rail.
export function proAccepts(config: ProConfig) {
  return config.rails.map((rail) => {
    const base = { scheme: "exact", network: rail.network, payTo: config.payTo };
    switch (rail.kind) {
      case "usdg":
        return { ...base, price: { amount: rail.atomic, asset: USDG.address, extra: { ...USDG.eip712 } } };
      case "autonomo":
        return { ...base, price: { amount: rail.atomic, asset: TOKEN.address, extra: { assetTransferMethod: "permit2" } } };
      case "usdc":
        return { ...base, price: `$${rail.priceUsd}` };
    }
  });
}
