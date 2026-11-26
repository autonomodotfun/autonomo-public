import type { Metadata } from "next";
import Link from "next/link";
import { PARTNERS, PartnerMark } from "@/components/partners";
import { TOKEN } from "@/lib/constants";
import { getThanks } from "@/lib/directory/queries";
import type { Thanks } from "@/lib/directory/thanks";
import { fmtAutonomo } from "@/lib/gateway/gateway-format";
import { burnEnabled, getBurns } from "@/lib/payments/burn";
import { retrySoon } from "@/lib/prerender";

export const metadata: Metadata = {
  title: "Thank you",
  description: "Thanksgiving 2026: a thank-you to the agents, creators and partners behind Autonomo's first weeks, with the numbers counted from payments on-chain.",
};

const fmt = new Intl.NumberFormat("en");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt.format(n)} ${n === 1 ? one : many}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// The same three firsts the roadmap lists under Milestones.
const FIRSTS = [
  { when: "November 3", what: "The first outside agent paid on its own", who: "Minimum Viable Agent paid the Risk Checker from its own wallet." },
  { when: "November 6", what: "The first borrow-and-pay on-chain", who: "A test agent with no USDG borrowed through Borro and paid New Launches in one request." },
  { when: "November 18", what: "The first payments in USDC on Base", who: "An agent paid official APIs in USDC on Base." },
];

export default async function ThanksPage() {
  let thanks: Thanks | null = null;
  let burned: string | null = null;
  try {
    thanks = await getThanks();
  } catch (e) {
    console.error("thanks numbers failed", e);
    await retrySoon();
  }
  if (burnEnabled()) {
    try {
      const { totals } = await getBurns();
      burned = totals.reduce((sum, t) => sum + BigInt(t.burned), 0n).toString();
    } catch (e) {
      console.error("thanks burn total failed", e);
      await retrySoon();
    }
  }
  const any = thanks !== null && thanks.paidCalls > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">Thanksgiving 2026</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">Thank you</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Autonomo is a few weeks old. It only works because agents pay for calls, creators launch APIs and other teams
        build with us. So this is a thank-you, with the numbers behind it. Each one is counted from payments that settled
        on-chain, not from sign-ups or page views.
      </p>

      {thanks === null ? (
        <p className="mt-8 text-muted">The numbers can&apos;t be loaded right now. Try again in a few minutes.</p>
      ) : (
        <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Stat value={fmt.format(thanks.paidCalls)} label="paid calls" note={thanks.firstPaidAt ? `Since the first one, on ${day(thanks.firstPaidAt)}` : "Since launch"} />
          <Stat value={fmt.format(thanks.payers)} label={thanks.payers === 1 ? "wallet that paid" : "wallets that paid"} note="Outside wallets, each counted once" />
          <Stat value={fmt.format(thanks.cameBack)} label="came back" note="Paid again on another day" />
          {burned !== null ? (
            <Stat value={fmtAutonomo(burned).replace(" AUTONOMO", "")} label={`${TOKEN.symbol} burned`} note="From paid calls, with a receipt for each burn" />
          ) : (
            <Stat value={fmt.format(thanks.apis)} label={thanks.apis === 1 ? "live API" : "live APIs"} note="Each one paid per call" />
          )}
        </div>
      )}

      <section className="mt-12">
        <h2 className="heading text-2xl">To everyone who paid for a call</h2>
        <p className="mt-3 text-muted">
          {any ? (
            <>
              {plural(thanks!.payers, "wallet")} paid for {plural(thanks!.paidCalls, "call")}, with no account and no API key,
              and {thanks!.cameBack === 0 ? "we hope to see you again" : `${fmt.format(thanks!.cameBack)} came back on another day`}.
              {thanks!.privateCalls > 0 && <> {plural(thanks!.privateCalls, "call")} more were paid privately through Gloam, so we can&apos;t count who.</>}{" "}
            </>
          ) : (
            <>Every paid call is a vote that this is worth doing. </>
          )}
          You are the reason the rest of this page exists. Thank you.
        </p>
        <ul className="mt-5 divide-y divide-line rounded-lg border border-line">
          {FIRSTS.map((f) => (
            <li key={f.when} className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <span className="font-mono text-xs text-faint uppercase sm:pt-1">{f.when}</span>
              <span>
                <span className="text-ink">{f.what}.</span> <span className="text-muted">{f.who}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          The live counts for each API are on the <Link href="/numbers">Numbers page</Link>.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="heading text-2xl">To the people who launched an API</h2>
        <p className="mt-3 text-muted">
          {thanks !== null && thanks.apis > 0 ? (
            <>
              {plural(thanks.apis, "API")} {thanks.apis === 1 ? "is" : "are"} live today, run from {plural(thanks.creators, "wallet")}.{" "}
            </>
          ) : null}
          Putting a price on your work and letting strangers&apos; agents pay for it takes some trust. Thank you for
          giving it early. <Link href="/projects">See the APIs</Link>, or <Link href="/dashboard">launch your own</Link>.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="heading text-2xl">To the teams building with us</h2>
        <p className="mt-3 text-muted">
          {plural(PARTNERS.length, "team")} added something Autonomo couldn&apos;t have built alone: private payments, credit,
          jobs, proofs, records and wallets. Thank you.
        </p>
        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {PARTNERS.map((p) => (
            <a key={p.name} href={p.href} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-3 bg-bg p-4 no-underline hover:bg-surface">
              <span className="font-mono text-xs tracking-wide text-faint uppercase">{p.what}</span>
              <PartnerMark partner={p} className="h-7 w-auto" />
            </a>
          ))}
          {/* Empty cells that finish the last row of four on wide screens, so the grid's lines don't show through. */}
          {Array.from({ length: (4 - (PARTNERS.length % 4)) % 4 }, (_, i) => (
            <div key={`fill-${i}`} aria-hidden className="hidden bg-bg lg:block" />
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          What each one adds is on the <Link href="/partners">Partners page</Link>.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="heading text-2xl">And to everyone following along</h2>
        <p className="mt-3 text-muted">
          To the people who hold {TOKEN.symbol}, report what&apos;s broken, ask hard questions and tell us what to build next:
          thank you. Come say hello on <a href="https://x.com/useautonomo">X</a> or in{" "}
          <a href="https://t.me/autonomodotfun">Telegram</a>.
        </p>
      </section>

      <p className="mt-12 text-xs text-faint">
        The numbers update every hour. A wallet is counted once, however many APIs it paid. An API&apos;s own wallets
        aren&apos;t counted as payers, and the Playground and the Telegram bot pay from one wallet, so they count as one.
      </p>
    </div>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="bg-surface p-4">
      <p className="heading text-3xl text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink">{label}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}
