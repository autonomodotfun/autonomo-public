"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavGroup } from "./nav";

// What sits around every docs page: the side menu, the "On this page" list, the group label above a guide's title and
// the previous / next links. Also redirects for links to sections that moved off the docs home.

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
  directory: "/docs/directory",
  "how-x402-works": "/docs/x402",
  faq: "/docs/faq",
  roadmap: "/roadmap",
};

/** A menu entry that is a page of its own, not a section of another page. */
const isPage = (href: string) => !href.includes("#");

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
          <h2 className="mb-1.5 text-xs font-medium tracking-wide text-faint uppercase lg:px-2">{g.title}</h2>
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
    <aside className="text-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
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

/** The group a guide belongs to, shown above its title: "Build an agent", "Ways to pay". */
export function GroupLabel({ groups, fallback }: { groups: NavGroup[]; fallback: string }) {
  const pathname = usePathname();
  return <>{groups.find((g) => g.items.some((i) => i.href === pathname))?.title ?? fallback}</>;
}

type Heading = { id: string; text: string };

/** The page's sections, read from the page itself, and the one being read now. */
function useSections(pathname: string) {
  const [sections, setSections] = useState<Heading[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const found = [...document.querySelectorAll<HTMLElement>("article section[id] > h2")].map((h) => ({
        id: h.parentElement?.id ?? "",
        text: h.textContent ?? "",
      }));
      setSections((old) => (old.map((s) => s.id).join() === found.map((s) => s.id).join() ? old : found));
    };
    read();
    // A page that loads data arrives after its skeleton.
    const root = document.getElementById("docs-content");
    const watch = new MutationObserver(read);
    if (root) watch.observe(root, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (!sections.length) return;
    let frame = 0;
    const mark = () => {
      frame = 0;
      let now: string | null = null;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) now = s.id;
      }
      setCurrent(now);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(mark);
    };
    mark();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);

  return { sections, current };
}

/**
 * "On this page": a guide's sections. Beside the guide on wide screens (`side`), and a fold-out above it on narrower
 * ones (`top`). Short pages and the docs home don't get one.
 */
export function DocsToc({ variant }: { variant: "side" | "top" }) {
  const pathname = usePathname();
  const { sections, current } = useSections(pathname);
  if (pathname === "/docs" || sections.length < 3) return null;

  const links = (
    <ul className="space-y-1.5">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            aria-current={s.id === current ? "location" : undefined}
            className={`block no-underline ${s.id === current ? "font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            {s.text}
          </a>
        </li>
      ))}
    </ul>
  );

  if (variant === "top") {
    return (
      <details className="mb-8 rounded-lg border border-line px-4 py-3 text-sm xl:hidden">
        <summary className="cursor-pointer font-medium">On this page</summary>
        <div className="mt-3">{links}</div>
      </details>
    );
  }
  return (
    <aside className="hidden w-44 text-sm xl:sticky xl:top-6 xl:block xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">On this page</h2>
      <nav aria-label="On this page">{links}</nav>
    </aside>
  );
}

/** Previous and next guide, in the menu's order. */
export function DocsPager({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const pages = groups.flatMap((g) => g.items.filter((i) => isPage(i.href)).map((i) => ({ ...i, group: g.title })));
  const at = pages.findIndex((p) => p.href === pathname);
  if (at < 0) return null;
  const prev = pages[at - 1];
  const next = pages[at + 1];
  const card = "rounded-lg border border-line p-4 no-underline hover:bg-surface";

  return (
    <nav aria-label="More guides" className="mt-14 grid max-w-3xl gap-3 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className={card}>
          <span className="block font-mono text-xs tracking-wide text-faint uppercase">← Previous</span>
          <span className="mt-1 block font-medium text-ink">{prev.href === "/docs" ? prev.label : `${prev.group}: ${prev.label}`}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next && (
        <Link href={next.href} className={`${card} sm:text-right`}>
          <span className="block font-mono text-xs tracking-wide text-faint uppercase">Next →</span>
          <span className="mt-1 block font-medium text-ink">{`${next.group}: ${next.label}`}</span>
        </Link>
      )}
    </nav>
  );
}
