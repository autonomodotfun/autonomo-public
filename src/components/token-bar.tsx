import { TOKEN } from "@/lib/constants";
import { CopyButton } from "@/components/copy-button";

// Site-wide strip with the token contract address and a copy button. Kept quiet so it doesn't compete with the page.
export function TokenBar() {
  const short = `${TOKEN.address.slice(0, 6)}…${TOKEN.address.slice(-4)}`;
  return (
    <div className="border-b border-line text-muted">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-4 py-1.5 font-mono text-xs sm:px-6">
        <span>{TOKEN.symbol}</span>
        <span className="text-faint">CA</span>
        <span className="select-all" title={TOKEN.address}>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{TOKEN.address}</span>
        </span>
        <CopyButton
          text={TOKEN.address}
          label={`Copy ${TOKEN.symbol} contract address`}
          className="rounded-sm border border-line px-1.5 py-0.5 uppercase hover:text-ink"
        />
      </div>
    </div>
  );
}
