import Link from "next/link";
import { CATEGORY_INFO } from "@/lib/categories";
import { formatUsd, isTestnet, networkLabel } from "@/lib/networks";
import { getVerifiedGateways, type ProjectListItem } from "@/lib/queries";
import { VerifiedBadge } from "@/components/verified";

export function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function NetworkChips({ networks, max = 3 }: { networks: string[]; max?: number }) {
  const mainnets = networks.filter((n) => !isTestnet(n));
  const shown = (mainnets.length ? mainnets : networks).slice(0, max);
  const rest = networks.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((n) => (
        <span key={n} className="rounded border border-line px-1.5 py-px font-mono text-[11px] text-muted">
          {networkLabel(n)}
        </span>
      ))}
      {rest > 0 && <span className="px-1 font-mono text-[11px] text-faint">+{rest}</span>}
    </span>
  );
}

export function ProjectRow({ p, verified = false }: { p: ProjectListItem; verified?: boolean }) {
  const isService = p.category === "service" || p.endpointCount > 0;
  return (
    <li>
      <Link
        href={`/projects/${p.slug}`}
        className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-4 py-4 hover:bg-surface sm:grid-cols-[1fr_7rem_7rem]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{p.name}</span>
            {verified && <VerifiedBadge />}
            {p.featured && (
              <span className="rounded bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">Featured</span>
            )}
            <span className="shrink-0 text-xs text-faint">{CATEGORY_INFO[p.category].label}</span>
          </div>
          {p.description && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{p.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {p.networks.length > 0 && <NetworkChips networks={p.networks} />}
            {p.host && <span className="truncate font-mono text-[11px] text-faint">{p.host}</span>}
          </div>
        </div>
        <div className="text-right">
          {isService ? (
            <>
              <div className="font-mono text-sm">{p.minPriceUsd ? `from ${formatUsd(p.minPriceUsd)}` : "—"}</div>
              <div className="text-xs text-faint">
                {p.endpointCount} endpoint{p.endpointCount === 1 ? "" : "s"}
              </div>
            </>
          ) : null}
        </div>
        <div className="hidden text-right sm:block">
          {isService && (
            <>
              <div className="font-mono text-sm">{compact(p.calls30d)}</div>
              <div className="text-xs text-faint">calls / 30d</div>
            </>
          )}
        </div>
      </Link>
    </li>
  );
}

export async function ProjectList({ rows }: { rows: ProjectListItem[] }) {
  const { projectSlugs } = await getVerifiedGateways();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-bg">
      {rows.map((p) => (
        <ProjectRow key={p.id} p={p} verified={projectSlugs.includes(p.slug)} />
      ))}
    </ul>
  );
}
