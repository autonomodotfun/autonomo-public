export const SOCIALS = [
  {
    label: "X",
    handle: "@autonomodotfun",
    href: "https://x.com/autonomodotfun",
    path: "M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.8 2h6.4l4.4 5.8L18.9 2Zm-1.1 18.1h1.7L8.3 3.8H6.5l11.3 16.3Z",
  },
  {
    label: "Telegram",
    handle: "t.me/autonomodotfun",
    href: "https://t.me/autonomodotfun",
    path: "M21.9 4.3 18.8 19c-.2 1-.8 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.2.2-.5.5-1 .5l.3-4.8 8.8-7.9c.4-.3-.1-.5-.6-.2L6.7 12.9l-4.7-1.5c-1-.3-1-1 .2-1.5L20.5 2.9c.9-.3 1.6.2 1.4 1.4Z",
  },
];

/** X and Telegram icon links. */
export function Socials({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {SOCIALS.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Autonomo on ${s.label} (${s.handle})`}
          title={`${s.label}: ${s.handle}`}
          className="rounded p-1.5 text-muted transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
            <path d={s.path} />
          </svg>
        </a>
      ))}
    </div>
  );
}
