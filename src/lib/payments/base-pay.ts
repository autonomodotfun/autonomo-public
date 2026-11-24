import "server-only";
import type { Gateway } from "@/db/schema";
import { baseSplitterFor } from "@/lib/payments/burn";
import { baseForCreators, isOfficial, payeeOf } from "@/lib/gateway/gateway";
import { baseReady, basePayeeOk, baseSafeOk, platform } from "@/lib/payments/payments";

/** Why an API isn't offering USDC on Base right now, in words its owner can act on. */
export type BaseOff = "switched_off" | "not_available" | "coinbase_down" | "wallet" | "lookup_failed";

export const BASE_OFF_TEXT: Record<BaseOff, string> = {
  switched_off: "Switched off in this API's settings.",
  not_available: "Not available for this API on this deployment.",
  coinbase_down: "Coinbase's payment service isn't answering right now, so Base is paused. It comes back on its own.",
  wallet:
    "The wallet this API pays can't be paid on Base: it's a contract wallet that isn't the same Safe, with the same signers, on Base.",
  lookup_failed: "Your splitter on Base couldn't be looked up just now. It's checked again on the next call.",
};

/**
 * Where this API's USDC on Base is paid right now, or why it isn't offered. Official APIs are paid straight to
 * Autonomo's Safe on Base; creator APIs to the creator's splitter on Base, once their wallet can be paid there.
 */
export async function baseStatus(g: Gateway): Promise<{ payTo: string; off?: undefined } | { payTo: null; off: BaseOff }> {
  if (!g.acceptBase) return { payTo: null, off: "switched_off" };
  if (!platform.base || !(isOfficial(g) || baseForCreators())) return { payTo: null, off: "not_available" };
  if (!(await baseReady())) return { payTo: null, off: "coinbase_down" };
  const payee = payeeOf(g);
  if (isOfficial(g)) return (await baseSafeOk(payee)) ? { payTo: payee } : { payTo: null, off: "wallet" };
  if (!(await basePayeeOk(payee))) return { payTo: null, off: "wallet" };
  try {
    const splitter = await baseSplitterFor(payee);
    return splitter ? { payTo: splitter } : { payTo: null, off: "not_available" };
  } catch (e) {
    console.error("base splitter lookup failed; Base not offered", e);
    return { payTo: null, off: "lookup_failed" };
  }
}
