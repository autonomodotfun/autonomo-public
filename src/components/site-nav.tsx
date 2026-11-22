"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { Socials } from "@/components/socials";

// The header menu. On wider screens: four links and a More menu. On phones: a button that opens the whole menu as a
// full-screen list. The item for the page the visitor is on is highlighted.

/** A menu link. `about` is the line of help under it in the More menu; `primary` shows it large in the phone menu. */
export type NavItem = { href: string; label: string; about?: string; primary?: boolean };

/** The links always in the bar. Facilitators and SDKs are tabs on the Explore page, so they have no link here. */
export const MAIN: NavItem[] = [
  { href: "/projects", label: "Explore APIs" },
  { href: "/playground", label: "Playground" },
  { href: "/docs", label: "Docs" },
  { href: "/partners", label: "Partners" },
];

/** The href of the menu item that matches this page, if any. */
export function activeNav(pathname: string, items: NavItem[]): string | null {
  return items.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))?.href ?? null;
}

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** The pages that don't fit in the bar, behind one button. */
function MoreMenu({ items, active }: { items: NavItem[]; active: string | null }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const here = items.some((i) => i.href === active);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="more-menu"
        onClick={() => setOpen((o) => !o)}
        className={`flex cursor-pointer items-center gap-1 whitespace-nowrap ${open || here ? "text-ink" : "hover:text-ink"} ${here ? "font-medium" : ""}`}
      >
        More
        <Chevron className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <ul id="more-menu" hidden={!open} className="absolute top-full -left-3 z-20 mt-4 w-64 rounded-lg border border-line bg-surface p-1.5">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.href === active ? "page" : undefined}
              onClick={() => setOpen(false)}
              className="block rounded-md px-2.5 py-2 hover:bg-bg aria-[current=page]:bg-bg"
            >
              <span className="block font-medium text-ink">{i.label}</span>
              {i.about && <span className="mt-0.5 block text-xs text-muted">{i.about}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteNav({ more }: { more: NavItem[] }) {
  const active = activeNav(usePathname(), [...MAIN, ...more]);
  return (
    <nav aria-label="Main" className="hidden items-center gap-5 text-sm text-muted md:flex">
      {MAIN.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={n.href === active ? "page" : undefined}
          className={`nav-link whitespace-nowrap ${n.href === active ? "text-ink" : "hover:text-ink"}`}
        >
          {n.label}
        </Link>
      ))}
      <MoreMenu items={more} active={active} />
    </nav>
  );
}

const SQUARE = "grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md border border-line text-ink";

/** The phone menu: a button in the header that opens every link as a full-screen list. */
export function MobileMenu({ more }: { more: NavItem[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = activeNav(usePathname(), [...MAIN, ...more]);
  const close = () => dialog.current?.close();

  // The menu is for phones only: if the window grows to where the bar shows its links, close it.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = () => wide.matches && dialog.current?.close();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  const large = [...MAIN, ...more.filter((i) => i.primary)];
  const small = more.filter((i) => !i.primary);

  return (
    <>
      <button type="button" aria-label="Open menu" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} className={`${SQUARE} md:hidden`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      {/* A modal dialog: the browser keeps focus inside it, closes it on Escape and gives focus back to the button. */}
      <dialog ref={dialog} aria-label="Menu" className="site-menu m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-bg p-0 text-ink">
        <div className="flex min-h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-4 sm:px-6">
            <Link href="/" onClick={close} aria-label="Autonomo home">
              <Logo className="h-6 w-auto sm:h-7" />
            </Link>
            <button type="button" aria-label="Close menu" onClick={close} className={SQUARE}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <nav aria-label="Main" className="flex flex-1 flex-col px-4 pb-6 sm:px-6">
            <ul>
              {large.map((i) => (
                <li key={i.href} className="border-b border-line">
                  <Link
                    href={i.href}
                    onClick={close}
                    aria-current={i.href === active ? "page" : undefined}
                    className="heading block py-3.5 text-2xl aria-[current=page]:text-accent"
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="mt-3 flex flex-wrap gap-x-5 text-muted">
              {small.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={close}
                    aria-current={i.href === active ? "page" : undefined}
                    className="block py-2 hover:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink"
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-8">
              <Link href="/dashboard" onClick={close} className="btn-brand block px-3 py-3 text-center text-sm">
                Launch your API
              </Link>
              <Socials className="mt-4 justify-center" />
            </div>
          </nav>
        </div>
      </dialog>
    </>
  );
}
