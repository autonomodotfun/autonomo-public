// Autopad brand: an A-shaped chevron lifting off a launch pad, plus the AUTOPAD wordmark (Barlow Bold).
// The mark is always yellow with black ink; the wordmark uses currentColor.
export function Mark({ className, size }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <rect width="64" height="64" rx="10" fill="var(--color-brand)" />
      <g fill="var(--color-on-brand)">
        <path d="M32 9 49 41h-10L32 27.5 25 41H15Z" />
        <rect x="27.5" y="33" width="9" height="8" rx="1.5" />
        <rect x="11" y="46" width="42" height="7" rx="1.5" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 340 64" className={className} role="img" aria-label="Autopad">
      <Mark size={64} />
      <text
        x="82"
        y="52"
        fill="currentColor"
        fontFamily="var(--font-barlow), ui-sans-serif, system-ui, sans-serif"
        fontSize="57"
        fontWeight="700"
        letterSpacing="1"
      >
        AUTOPAD
      </text>
    </svg>
  );
}
