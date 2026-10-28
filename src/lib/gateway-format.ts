import { formatUnits } from "viem";
import { TOKEN } from "@/lib/constants";

// Amounts are stored in atomic units: USDG has 6 decimals, $AUTONOMO 18.

function trim(n: string, maxDecimals: number) {
  const [i, d = ""] = n.split(".");
  const dec = d.slice(0, maxDecimals).replace(/0+$/, "");
  return Number(i).toLocaleString("en") + (dec ? `.${dec}` : "");
}

export function fmtUsdg(atomic: string | null | undefined) {
  return `$${trim(formatUnits(BigInt(atomic || "0"), 6), 4)}`;
}

export function fmtAutonomo(atomic: string | null | undefined) {
  return `${trim(formatUnits(BigInt(atomic || "0"), TOKEN.decimals), 4)} AUTONOMO`;
}

export function fmtRail(rail: string | null, atomic: string | null) {
  if (rail === "usdg" || rail === "usdc") return fmtUsdg(atomic);
  if (rail === "autonomo") return fmtAutonomo(atomic);
  return "—";
}

export function shortAddr(a: string | null | undefined) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}
