import Link from "next/link";
import examples from "@/lib/bazaar-examples.json";
import { formatUsd } from "@/lib/networks";
import { listAutonomoGateways } from "@/lib/queries";

// The homepage's picture of the product: one paid call to Safe Swap, an official API, line by line. The path is the
// API's real one, the price is read from its gateway, and the answer is the API's own example answer (the one its
// Bazaar listing carries: a quote to swap 1 USDG for $AUTONOMO), cut to three of its fields. Lines appear one after
// another once, and all at once with motion turned off.

const API = {
  slug: "safe-swap",
  name: "Safe Swap",
  path: "/x/safe-swap/swap/quote",
  asks: "to swap 1 USDG for $AUTONOMO",
  checked: "Checked first: holders, the dev wallet and rug risk.",
  fallbackPrice: "0.01",
};

type Example = { verdict: string; price_impact_pct: number; round_trip_loss_pct: number };

async function usdgPrice() {
  try {
    const api = (await listAutonomoGateways()).find((g) => g.slug === API.slug);
    if (api?.acceptUsdg && api.priceUsd) return formatUsd(api.priceUsd);
  } catch (e) {
    console.error("payment demo price failed", e);
  }
  return formatUsd(API.fallbackPrice);
}

function Line({ i, who, children }: { i: number; who: "Agent" | "API" | "Burn"; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3" style={{ "--i": i } as React.CSSProperties}>
      <span className={`pt-px text-[11px] tracking-[0.12em] uppercase ${who === "Burn" ? "text-accent" : "text-faint"}`}>{who}</span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

export async function PaymentDemo() {
  const price = await usdgPrice();
  const answer = (examples as unknown as Record<string, Example>)[API.slug];
  const shown = {
    verdict: answer.verdict,
    price_impact_pct: answer.price_impact_pct,
    round_trip_loss_pct: answer.round_trip_loss_pct,
  };
  return (
    <figure className="rounded-lg border border-line bg-surface font-mono text-[13px] leading-relaxed">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 font-sans text-xs text-muted">
        <span>One paid call, start to finish</span>
        <Link href={`/projects/${API.slug}`} className="shrink-0 text-muted hover:text-ink">
          {API.name} →
        </Link>
      </figcaption>
      <ol className="pay-demo grid gap-3.5 p-4">
        <Line i={0} who="Agent">
          <span className="text-accent">GET</span>{" "}
          {/* Breaks only at slashes on a narrow screen, never mid-word. */}
          {API.path.split("/").map((part, n) => (
            <span key={n}>
              {n > 0 && "/"}
              {n > 1 && <wbr />}
              {part}
            </span>
          ))}
          <p className="text-muted">{API.asks}</p>
        </Line>
        <Line i={1} who="API">
          <span className="text-ink">402</span> <span className="text-muted">Payment Required</span>
          <p className="text-muted">
            <span className="text-ink">{price}</span> in USDG, or $AUTONOMO, or USDC on Base
          </p>
        </Line>
        <Line i={2} who="Agent">
          <span className="text-muted">signs {price} from its own wallet and asks again</span>
        </Line>
        <Line i={3} who="API">
          <span className="text-ink">200</span> <span className="text-muted">OK</span>
          <pre className="mt-1 overflow-x-auto text-muted">{JSON.stringify(shown, null, 2)}</pre>
          <p className="mt-1 text-muted">{API.checked}</p>
        </Line>
        <Line i={4} who="Burn">
          <span className="text-muted">
            5% of it buys back and burns $AUTONOMO.{" "}
            <Link href="/burn" className="underline decoration-faint underline-offset-2 hover:text-ink">
              See the burn
            </Link>
          </span>
        </Line>
      </ol>
    </figure>
  );
}
