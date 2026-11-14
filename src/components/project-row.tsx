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

/** A project's first letter on a tinted square, so rows are easy to tell apart without loading anyone's logo. */
export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const letter = (name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      aria-hidden
      style={{ backgroundColor: `hsl(${hue} 55% 50% / 0.16)`, color: `hsl(${hue} 62% var(--avatar-text-l))` }}
      className={`grid shrink-0 place-items-center rounded-md font-mono font-semibold ${
        size === "lg" ? "size-14 text-2xl" : "size-9 text-sm"
      }`}
    >
      {letter}
    </span>
  );
}

export function ProjectRow({ p, verified = false }: { p: ProjectListItem; verified?: boolean }) {
  const isService = p.category === "service" || p.endpointCount > 0;
  return (
    <li>
      <Link
        href={`/projects/${p.slug}`}
        className="grid grid-cols-[auto_1fr_auto] items-start gap-x-4 px-4 py-4 hover:bg-surface sm:grid-cols-[auto_1fr_7rem_6rem_5rem]"
      >
        <Avatar name={p.name} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{p.name}</span>
            {verified && <VerifiedBadge />}
            {p.autonomo && (
              <span className="shrink-0 rounded border border-accent px-1.5 py-px text-[11px] font-medium text-accent">Autonomo</span>
            )}
            {p.featured && (
              <span className="rounded bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">Featured</span>
            )}
            <span className="hidden shrink-0 text-xs text-faint sm:inline">{CATEGORY_INFO[p.category].label}</span>
          </div>
          {p.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted sm:line-clamp-1">{p.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {p.networks.length > 0 && <NetworkChips networks={p.networks} />}
            {p.host && <span className="truncate font-mono text-[11px] text-faint">{p.host}</span>}
          </div>
        </div>
        <div className="text-right">
          {isService && (
            <>
              <div className="font-mono text-sm whitespace-nowrap">{p.minPriceUsd ? `from ${formatUsd(p.minPriceUsd)}` : "—"}</div>
              <div className="text-xs text-faint">
                {compact(p.endpointCount)} endpoint{p.endpointCount === 1 ? "" : "s"}
              </div>
            </>
          )}
        </div>
        <Stat show={isService} value={p.calls30d} label="calls / 30d" />
        <Stat show={isService} value={p.payers30d} label="payers" />
      </Link>
    </li>
  );
}

function Stat({ show, value, label }: { show: boolean; value: number; label: string }) {
  return (
    <div className="hidden text-right sm:block">
      {show && (
        <>
          <div className={`font-mono text-sm ${value ? "" : "text-faint"}`}>{value ? compact(value) : "0"}</div>
          <div className="text-xs text-faint">{label}</div>
        </>
      )}
    </div>
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
