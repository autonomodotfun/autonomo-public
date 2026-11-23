import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { offersBase } from "@/lib/gateway";
import { AUTONOMO_DISCOUNT_LABEL } from "@/lib/gateway-rules";
import { formatUsd } from "@/lib/networks";
import type { getTrackRecords, listAutonomoGateways } from "@/lib/queries";
import { shelve } from "@/lib/api-shelves";
import { Avatar } from "@/components/project-row";

// An Autonomo API as a card: its name, what it does and what a call costs. Used on the homepage and the Explore page.

export type AutonomoApi = Awaited<ReturnType<typeof listAutonomoGateways>>[number];
type TrackRecords = Awaited<ReturnType<typeof getTrackRecords>>;

/** Paid calls an API settled in the track-record window. */
export const paidCalls = (records: TrackRecords | null, slug: string) => records?.[slug]?.settledCalls ?? 0;

/** The most-paid Autonomo APIs over the track-record window, in shelf order when tied. */
export function mostPaid(apis: AutonomoApi[], records: TrackRecords | null, count: number): AutonomoApi[] {
  const inShelfOrder = shelve(apis).flatMap((s) => s.apis);
  return [...inShelfOrder].sort((a, b) => paidCalls(records, b.slug) - paidCalls(records, a.slug)).slice(0, count);
}

/** What a call costs, in each token the API takes on Robinhood Chain. */
export function apiPrice(g: AutonomoApi): string {
  const usdg = g.acceptUsdg ? `${formatUsd(g.priceUsd)} USDG` : "";
  const autonomo = g.autonomoAmount ? `${Number(g.autonomoAmount).toLocaleString("en")} ${TOKEN.symbol} (${AUTONOMO_DISCOUNT_LABEL})` : "";
  return [usdg, autonomo].filter(Boolean).join(" · ");
}

export function ApiCard({ g, className = "" }: { g: AutonomoApi; className?: string }) {
  return (
    <li className={className}>
      <Link href={`/projects/${g.projectSlug}`} className="flex h-full gap-3 rounded-md border border-line bg-bg p-3 hover:border-faint">
        <Avatar name={g.name} src={g.logoUrl} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{g.name}</span>
          <span className="mt-0.5 line-clamp-2 text-xs text-muted">{g.description}</span>
          <span className="mt-1.5 block font-mono text-xs">{apiPrice(g)}</span>
          {offersBase(g) && <span className="mt-0.5 block font-mono text-xs text-muted">{formatUsd(g.priceUsd)} USDC on Base</span>}
        </span>
      </Link>
    </li>
  );
}
