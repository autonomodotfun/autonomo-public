import "server-only";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { ExactEvmScheme as ExactEvmFacilitator } from "@x402/evm/exact/facilitator";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi, parseUnits, publicActions, type Hex } from "viem";
import { base as baseChain } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { TOKEN } from "@/lib/constants";

// x402 payments for hosted gateways.
//
// Env:
//   FACILITATOR_PRIVATE_KEY   Gas-only wallet that settles Robinhood Chain payments in-process (USDG via EIP-3009,
//                             $AUTONOMO via Permit2; the token has no EIP-3009/EIP-2612). No hosted facilitator
//                             covers Robinhood Chain. Keep a little ETH on Robinhood Chain in it, nothing else.
//   CDP_API_KEY_ID            Coinbase Developer Platform keys. Coinbase's facilitator settles USDC on Base, so Base
//   CDP_API_KEY_SECRET        is offered only when both are set. It pays the API's own Safe, the pay-to set in /admin,
//                             and only once that Safe is checked on Base (see baseSafeOk()).
//   BASE_RPC_URL              Optional. Where Base is read from; https://mainnet.base.org by default.

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

// USD Coin on Base, checked on-chain: name "USD Coin", version "2", 6 decimals. EIP-3009, so Coinbase's facilitator
// pays the gas and the payer only signs.
export const USDC_BASE = {
  network: "eip155:8453" as Network,
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
  eip712: { name: "USD Coin", version: "2" },
  explorer: "https://basescan.org",
} as const;

function env(name: string) {
  return process.env[name]?.trim() || undefined;
}

// What this deployment can settle, independent of who gets paid.
export const platform = {
  robinhood: Boolean(env("FACILITATOR_PRIVATE_KEY")),
  base: Boolean(env("CDP_API_KEY_ID") && env("CDP_API_KEY_SECRET")),
};

export type Rail = "usdg" | "autonomo" | "usdc_base";

export type Pricing = {
  priceUsd: string;
  acceptUsdg: boolean;
  autonomoAmount: string | null;
};

export type RailOffer =
  | { kind: "usdg"; network: Network; priceUsd: string; atomic: string }
  | { kind: "autonomo"; network: Network; amount: string; atomic: string }
  | { kind: "usdc_base"; network: Network; priceUsd: string; atomic: string; payTo: string };

/**
 * The payment options a price can actually be settled in on this deployment. `basePayTo` adds USDC on Base at the
 * same dollar price, paid there; the caller decides which APIs get it and checks the Safe and Coinbase first.
 */
export function offers(p: Pricing, opts: { basePayTo?: string | null } = {}): RailOffer[] {
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
  if (opts.basePayTo && isAddress(opts.basePayTo) && platform.base && Number(p.priceUsd) > 0) {
    out.push({
      kind: "usdc_base",
      network: USDC_BASE.network,
      priceUsd: p.priceUsd,
      atomic: parseUnits(p.priceUsd, USDC_BASE.decimals).toString(),
      payTo: getAddress(opts.basePayTo),
    });
  }
  return out;
}

/** x402 `accepts` entries for a set of offers. Robinhood Chain options pay `payTo`; Base pays its own Safe. */
export function acceptsFor(payTo: string, list: RailOffer[]) {
  return list.map((o) => {
    const base = { scheme: "exact", network: o.network, payTo };
    switch (o.kind) {
      case "usdg":
        return { ...base, price: { amount: o.atomic, asset: USDG.address, extra: { ...USDG.eip712 } } };
      case "autonomo":
        return { ...base, price: { amount: o.atomic, asset: TOKEN.address, extra: { assetTransferMethod: "permit2" } } };
      case "usdc_base":
        return { ...base, payTo: o.payTo, price: { amount: o.atomic, asset: USDC_BASE.address, extra: { ...USDC_BASE.eip712 } } };
    }
  });
}

/** Which rail a payment belongs to (for recording payments). The network tells USDC on Base apart. */
export function railForAsset(asset: string | undefined, network?: string): Rail | null {
  const a = asset?.toLowerCase();
  if (network === USDC_BASE.network) return a === USDC_BASE.address.toLowerCase() ? "usdc_base" : null;
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

type Supported = Awaited<ReturnType<FacilitatorClient["getSupported"]>>;

const CDP_HOST = "api.cdp.coinbase.com";
const CDP_PATH = "/platform/v2/x402";
const SUPPORTED_TTL_MS = 6 * 3_600_000;
const SUPPORTED_RETRY_MS = 60_000;

// Coinbase's hosted facilitator, which settles USDC on Base. Each request carries a short-lived JWT signed with the
// CDP key, bound to that request's method, host and path.
function cdpFacilitator(): FacilitatorClient {
  const apiKeyId = env("CDP_API_KEY_ID")!;
  const apiKeySecret = env("CDP_API_KEY_SECRET")!;
  const auth = async (path: string, method = "POST") => ({
    Authorization: `Bearer ${await generateJwt({ apiKeyId, apiKeySecret, requestMethod: method, requestHost: CDP_HOST, requestPath: `${CDP_PATH}/${path}` })}`,
  });
  const client = new HTTPFacilitatorClient({
    url: `https://${CDP_HOST}${CDP_PATH}`,
    createAuthHeaders: async () => {
      const [verify, settle, supported] = await Promise.all([auth("verify"), auth("settle"), auth("supported", "GET")]);
      return { verify, settle, supported };
    },
  });

  // What Coinbase supports, kept for 6 hours. Once known, a failed refresh keeps the last answer: a gateway's 402 is
  // built from it and kept, so it must not flip because Coinbase blinked. A failure before the first answer is
  // retried after a minute.
  let known: { value: Supported; until: number } | null = null;
  let failedUntil = 0;
  let pending: Promise<Supported> | null = null;
  const getSupported = async (): Promise<Supported> => {
    if (known && known.until > Date.now()) return known.value;
    if (!known && failedUntil > Date.now()) throw new Error("Coinbase facilitator unavailable");
    pending ??= client
      .getSupported()
      .then((value) => {
        known = { value, until: Date.now() + SUPPORTED_TTL_MS };
        return value;
      })
      .catch((e) => {
        if (known) return known.value;
        failedUntil = Date.now() + SUPPORTED_RETRY_MS;
        throw e;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };

  return {
    verify: (payload, requirements) => client.verify(payload, requirements),
    settle: (payload, requirements) => client.settle(payload, requirements),
    getSupported,
  };
}

let server: x402ResourceServer | undefined;
let cdp: FacilitatorClient | undefined;

/** Shared resource server for every paid route; null when nothing can be settled. */
export function x402Server() {
  if (server) return server;
  if (!platform.robinhood) return null;
  // Earlier facilitators win for a network, so Robinhood Chain always stays with the in-process one.
  const facilitators = [localFacilitator()];
  if (platform.base) facilitators.push((cdp = cdpFacilitator()));
  server = new x402ResourceServer(facilitators);
  server.register(TOKEN.network, new ExactEvmServer());
  if (platform.base) server.register(USDC_BASE.network, new ExactEvmServer());
  return server;
}

const SAFE_ABI = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
const SAFE_OK_TTL_MS = 3_600_000;
const SAFE_RETRY_MS = 120_000;
const safeChecks = new Map<string, { ok: boolean; until: number }>();

/** A Safe's signers and threshold on one chain, or null when there is no Safe there. */
async function safeSetup(chain: "base" | "robinhood", address: `0x${string}`) {
  const client =
    chain === "base"
      ? createPublicClient({ chain: baseChain, transport: http(env("BASE_RPC_URL") ?? "https://mainnet.base.org") })
      : createPublicClient({ chain: robinhood, transport: http(env("ROBINHOOD_RPC_URL")) });
  try {
    const [owners, threshold] = await Promise.all([
      client.readContract({ address, abi: SAFE_ABI, functionName: "getOwners" }),
      client.readContract({ address, abi: SAFE_ABI, functionName: "getThreshold" }),
    ]);
    return { owners: owners.map((o) => o.toLowerCase()).sort(), threshold };
  } catch (e) {
    // An empty address answers with no data, which can't be decoded: no Safe there.
    if (e instanceof Error && /returned no data|0x"? is not a valid|ContractFunctionZeroData/i.test(`${e.name} ${e.message}`)) return null;
    throw e;
  }
}

/**
 * Whether USDC on Base can be paid to `payTo`: it is a Safe on Base with the same signers and threshold as on
 * Robinhood Chain. The pay-to is set and checked in /admin as a Robinhood Chain address, so without this an address
 * that is empty on Base, or controlled by someone else there, could be paid. Kept for an hour once it passes, so a
 * signer change on one chain only is caught within the hour; a failure is checked again after two minutes.
 */
export async function baseSafeOk(payTo: string): Promise<boolean> {
  if (!isAddress(payTo)) return false;
  const key = payTo.toLowerCase();
  const hit = safeChecks.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const address = getAddress(payTo);
    const [onBase, onRobinhood] = await Promise.all([safeSetup("base", address), safeSetup("robinhood", address)]);
    ok =
      !!onBase &&
      !!onRobinhood &&
      onBase.threshold > 0n &&
      onBase.threshold === onRobinhood.threshold &&
      onBase.owners.join() === onRobinhood.owners.join();
    if (!ok) console.error(`Base not offered: ${address} is not the same Safe on Base and Robinhood Chain`);
  } catch (e) {
    console.error("Base Safe check failed; Base not offered", e);
  }
  if (safeChecks.size > 500) safeChecks.clear();
  safeChecks.set(key, { ok, until: Date.now() + (ok ? SAFE_OK_TTL_MS : SAFE_RETRY_MS) });
  return ok;
}

/**
 * Whether USDC on Base can be offered right now: it's configured, and Coinbase's facilitator says it settles exact
 * payments on Base. Offering it without that would break the whole 402, not just the Base option.
 */
export async function baseReady(): Promise<boolean> {
  if (!platform.base || !x402Server() || !cdp) return false;
  try {
    const supported = await cdp.getSupported();
    return supported.kinds.some((k) => k.x402Version === 2 && k.network === USDC_BASE.network && k.scheme === "exact");
  } catch (e) {
    console.error("Coinbase facilitator unavailable; Base not offered", e);
    return false;
  }
}
