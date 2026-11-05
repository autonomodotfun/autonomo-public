"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// The side menu for every docs page, and redirects for links to sections that moved off the docs home.

type NavItem = { href: string; label: string };
export type NavGroup = { title: string; items: NavItem[] };

// Old /docs#section links, from before the docs were split into pages.
const MOVED: Record<string, string> = {
  launch: "/docs/launch",
  "official-apis": "/docs/official-apis",
  "official-wallets": "/docs/official-apis#official-wallets",
  "first-outside-payer": "/docs/official-apis#first-outside-payer",
  mcp: "/docs/agents#mcp",
  agents: "/docs/agents#code",
  telegram: "/docs/agents#telegram",
  api: "/api-docs",
  token: "/docs/token",
  burn: "/docs/token#burn",
  data: "/docs/directory#data",
};

export function DocsNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== "/docs") return;
    const to = MOVED[window.location.hash.slice(1)];
    if (to) router.replace(to);
  }, [pathname, router]);

  const list = (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.title}>
          <h2 className="mb-1.5 text-xs font-medium tracking-wide text-faint uppercase">{g.title}</h2>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = item.href === pathname;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded py-1 lg:px-2 ${active ? "font-medium text-ink lg:bg-surface" : "text-muted hover:text-ink"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <aside className="text-sm lg:sticky lg:top-6 lg:self-start">
      <details className="rounded-lg border border-line px-4 py-3 lg:hidden">
        <summary className="cursor-pointer font-medium">Docs menu</summary>
        <div className="mt-4">{list}</div>
      </details>
      <nav aria-label="Docs" className="hidden lg:block">
        {list}
      </nav>
    </aside>
  );
}
