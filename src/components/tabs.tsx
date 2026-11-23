"use client";

import { useState } from "react";

// A row of tabs over one panel at a time. Every panel is in the page from the start, so switching is instant and
// the hidden lists are still there for search engines.

export type TabItem = { id: string; label: string; panel: React.ReactNode };

export function Tabs({ label, tabs }: { label: string; tabs: TabItem[] }) {
  const [current, setCurrent] = useState(tabs[0]?.id);

  // Left and right arrows move between tabs, as the tab pattern expects.
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    setCurrent(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <div>
      {/* The line under the tabs is on the inner row, so a tab's own underline sits on it without making the row scroll. */}
      <div className="overflow-x-auto">
        <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line text-sm whitespace-nowrap">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={t.id === current}
              aria-controls={`panel-${t.id}`}
              tabIndex={t.id === current ? 0 : -1}
              onClick={() => setCurrent(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-2 ${
                t.id === current ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== current} className="mt-4">
          {t.panel}
        </div>
      ))}
    </div>
  );
}
