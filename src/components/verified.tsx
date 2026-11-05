import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { verifiedAmount, verifiedEnabled, verifiedStatus } from "@/lib/verified";

export function VerifiedBadge() {
  return (
    <span
      title={`The wallet behind this API holds about ${verifiedAmount()} or more of ${TOKEN.symbol}. This isn't a review of the API.`}
      className="shrink-0 rounded bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent"
    >
      ✓ Verified
    </span>
  );
}

/** On the dashboard: whether this wallet's APIs show as Verified, and how to get there. */
export async function VerifiedPanel({ owner, className = "" }: { owner: string; className?: string }) {
  if (!verifiedEnabled()) return null;
  const { balance, required, verified, locked } = await verifiedStatus(owner);
  return (
    <div className={`rounded-lg border border-line p-4 text-sm ${className}`}>
      <p className="font-medium">
        {verified ? (
          <>
            Your APIs show as <VerifiedBadge />
          </>
        ) : (
          `Launching is free. Hold about ${verifiedAmount()} of ${TOKEN.symbol} to show as Verified`
        )}
      </p>
      <p className="mt-1 text-muted">
        {required === null
          ? "We couldn't read this week's amount just now."
          : locked
            ? `Your amount is locked at ${required} ${TOKEN.symbol}.`
            : `This week that's ${required} ${TOKEN.symbol}.`}{" "}
        {balance === null ? "We couldn't read your balance just now." : `Your wallet holds ${balance}.`} The tokens stay yours.{" "}
        {!verified && (
          <a
            href={`https://dexscreener.com/robinhood/${TOKEN.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-ink"
          >
            Get {TOKEN.symbol}
          </a>
        )}
      </p>
      <p className="mt-1 font-mono text-xs break-all text-faint">
        {owner} ·{" "}
        <Link href="/docs/token#verified" className="underline hover:text-ink">
          How it works
        </Link>
      </p>
    </div>
  );
}
