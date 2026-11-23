"use client";

import { useEffect, useRef } from "react";

// The Explore page's filters on phones and tablets: a Filters button that opens them as a sheet from the bottom of
// the screen. On wide screens the same filters sit beside the list, so the button is hidden there.

export function FilterSheet({ count, children }: { count: number; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  // If the window grows to where the filters show beside the list, close the sheet.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => wide.matches && dialog.current?.close();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface lg:hidden"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </svg>
        Filters
        {count > 0 && (
          <span className="rounded-sm bg-brand px-1.5 font-mono text-xs font-medium text-on-brand" aria-label={`${count} in use`}>
            {count}
          </span>
        )}
      </button>
      {/* A modal dialog, so the browser keeps focus inside it and closes it on Escape. Picking a filter opens the
          filtered list, so any link inside closes the sheet, as does a tap on the dimmed page behind it. */}
      <dialog
        ref={dialog}
        aria-label="Filters"
        onClick={(e) => {
          if (e.target === dialog.current || (e.target as HTMLElement).closest("a")) close();
        }}
        className="filter-sheet fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-xl border-t border-line bg-surface p-0 text-ink backdrop:bg-black/60"
      >
        <div className="px-4 pt-3 pb-6 sm:px-6">
          <div className="flex items-center justify-between">
            <h2 className="heading text-lg">Filters</h2>
            <button type="button" aria-label="Close filters" onClick={close} className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-line">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {/* Taller rows than beside the list, so each choice is easy to tap. */}
          <div className="mt-4 text-sm [&_li>a]:py-2">{children}</div>
        </div>
      </dialog>
    </>
  );
}
