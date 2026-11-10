import { isAddress } from "viem";
import { reserveReport, returnReport, webVisitorId } from "@/lib/agent-limits";
import { playgroundPaymentsEnabled } from "@/lib/playground-pay";
import { checkWallet } from "@/lib/research";
import { researchSampleMode, sampleDeps } from "@/lib/research-sample";

// One payment to Wallet Portfolio.
export const maxDuration = 60;

// The "Check this wallet" buttons on a research report in the Playground: pays Wallet Portfolio for one of the top
// holders the report listed, and reads it against that token. Holder checks have their own free daily count, the same
// size as reports.

const MINUTE = 60_000;
const recent = new Map<string, number[]>();

function tooFast(visitor: string) {
  const now = Date.now();
  const hits = (recent.get(visitor) ?? []).filter((t) => now - t < MINUTE);
  hits.push(now);
  recent.set(visitor, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 5;
}

export async function POST(request: Request) {
  const visitor = webVisitorId(request.headers);
  if (tooFast(visitor)) return Response.json({ error: "Too many checks, try again in a minute." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { token?: unknown; wallet?: unknown; sample?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  if (!isAddress(token, { strict: false }) || !isAddress(wallet, { strict: false })) {
    return Response.json({ error: "That isn't a token and wallet address." }, { status: 400 });
  }
  // Local development only: a sample check, with nothing paid and nothing counted (see research-sample.ts).
  if (researchSampleMode(body?.sample === true)) {
    const result = await checkWallet(wallet, token, "holder", sampleDeps(token));
    return result.ok ? Response.json({ check: result.check, receipt: result.receipt }) : Response.json({ error: result.error }, { status: 422 });
  }
  if (!playgroundPaymentsEnabled()) return Response.json({ error: "Checks aren't live yet." }, { status: 503 });

  const allowance = await reserveReport(visitor, "holder");
  if (!allowance.ok) return Response.json({ error: allowance.detail, freeLeft: 0 }, { status: 429 });

  try {
    const result = await checkWallet(wallet, token, "holder");
    if (result.ok) return Response.json({ check: result.check, receipt: result.receipt, freeLeft: allowance.left });
    // A failed payment takes nothing, so the free check is handed back.
    await returnReport(allowance.subject, "holder");
    return Response.json({ error: result.error, freeLeft: allowance.left + 1 }, { status: result.resting ? 503 : 422 });
  } catch (e) {
    console.error("holder check failed", e);
    return Response.json({ error: "The check didn't finish. Try again in a moment.", freeLeft: allowance.left }, { status: 502 });
  }
}
