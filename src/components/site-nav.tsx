"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

// The header menu. The item for the page the visitor is on is highlighted.

const NAV = [
  { href: "/projects", label: "Explore APIs" },
  { href: "/projects?category=facilitator", label: "Facilitators" },
  { href: "/projects?category=sdk", label: "SDKs" },
  { href: "/playground", label: "Playground" },
  { href: "/docs", label: "Docs" },
  { href: "/roadmap", label: "Roadmap" },
  // On tablets the Launch button next to the menu goes to the dashboard, so this item waits for wider screens.
  { href: "/dashboard", label: "Dashboard", wideOnly: true },
];

/** Category pages that have their own menu item; every other /projects page belongs to "Explore APIs". */
const MENU_CATEGORIES = ["facilitator", "sdk"];

/** The href of the menu item that matches this page, if any. */
export function activeNav(pathname: string, category: string | null): string | null {
  if (pathname === "/projects" && category && MENU_CATEGORIES.includes(category)) return `/projects?category=${category}`;
  const item = NAV.find((n) => !n.href.includes("?") && (pathname === n.href || pathname.startsWith(`${n.href}/`)));
  return item?.href ?? null;
}

const CLASS = "nav-link whitespace-nowrap";

function Links({ active }: { active: string | null }) {
  return NAV.map((n) => (
    <Link
      key={n.href}
      href={n.href}
      aria-current={n.href === active ? "page" : undefined}
      className={`${CLASS} ${n.href === active ? "text-ink" : "hover:text-ink"} ${"wideOnly" in n ? "hidden lg:block" : ""}`}
    >
      {n.label}
    </Link>
  ));
}

function ActiveLinks() {
  const pathname = usePathname();
  const category = useSearchParams().get("category");
  return <Links active={activeNav(pathname, category)} />;
}

export function SiteNav() {
  return (
    <nav aria-label="Main" className="hidden gap-4 text-sm text-muted md:flex lg:gap-5">
      {/* Cached pages are built without the query string, so the highlight fills in once the page loads. */}
      <Suspense fallback={<Links active={null} />}>
        <ActiveLinks />
      </Suspense>
    </nav>
  );
}
