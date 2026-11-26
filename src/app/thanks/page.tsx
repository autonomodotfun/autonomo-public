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
  { when: "Nov 3", what: "The first outside agent paid on its own", who: "Minimum Viable Agent paid the Risk Checker from its own wallet." },
  { when: "Nov 6", what: "The first borrow-and-pay on-chain", who: "A test agent with no USDG borrowed through Borro and paid New Launches in one request." },
  { when: "Nov 18", what: "The first payments in USDC on Base", who: "An agent paid official APIs in USDC on Base." },
];

const link = "text-ink underline decoration-brand decoration-2 underline-offset-4 hover:decoration-ink";

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

  // The receipt's lines. The fourth is the burn where burning is on, and the live APIs where it isn't.
  const lines: { label: string; value: string }[] = thanks
    ? [
        { label: "Paid calls", value: fmt.format(thanks.paidCalls) },
        { label: thanks.payers === 1 ? "Wallet that paid" : "Wallets that paid", value: fmt.format(thanks.payers) },
        { label: "Came back another day", value: fmt.format(thanks.cameBack) },
        burned !== null
          ? { label: `${TOKEN.symbol} burned`, value: fmtAutonomo(burned).replace(" AUTONOMO", "") }
          : { label: thanks.apis === 1 ? "Live API" : "Live APIs", value: fmt.format(thanks.apis) },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* The thank-you, and its receipt */}
      <section className="grid gap-10 pt-14 pb-12 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center lg:gap-14">
        <div>
          <p className="font-mono text-xs tracking-wide text-accent uppercase">Thanksgiving 2026</p>
          <h1 className="heading mt-3 text-7xl leading-[0.9] sm:text-8xl lg:text-9xl">
            Thank <span className="underline decoration-brand decoration-[0.12em] underline-offset-[0.08em]">you</span>.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Autonomo is a few weeks old. It only works because agents pay for calls, creators launch APIs and other teams
            build with us. So here is a thank-you, with a receipt.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-surface font-mono text-sm">
          <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-line px-5 py-3 text-xs tracking-[0.14em] text-muted uppercase">
            <span>Receipt</span>
            <span>{thanks?.firstPaidAt ? `Since ${day(thanks.firstPaidAt)}` : "Since launch"}</span>
          </div>
          {thanks === null ? (
            <p className="px-5 py-8 font-sans text-muted">The numbers can&apos;t be loaded right now. Try again in a few minutes.</p>
          ) : (
            <dl className="px-5 py-2">
              {lines.map((l) => (
                <div key={l.label} className="flex items-end gap-2 py-2.5">
                  <dt className="text-muted">{l.label}</dt>
                  <span aria-hidden className="mb-1.5 min-w-4 flex-1 border-b border-dotted border-faint" />
                  <dd className="heading text-3xl leading-none text-ink tabular-nums">{l.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-dashed border-line px-5 py-4">
            <span className="text-xs tracking-[0.14em] text-muted uppercase">Paid in full</span>
            <span className="rounded-sm bg-brand px-2 py-1 text-xs font-semibold tracking-[0.14em] text-on-brand uppercase">Thank you</span>
          </div>
          <p className="border-t border-line px-5 py-3 font-sans text-xs text-faint">
            Counted from payments that settled on-chain, not from sign-ups or page views.
          </p>
        </div>
      </section>

      {/* Four thank-yous */}
      <div className="border-t border-line">
        <Letter n={1} to="Everyone who paid for a call">
          <p>
            {any ? (
              <>
                <b className="font-medium text-ink">{plural(thanks!.payers, "wallet")}</b> paid for{" "}
                <b className="font-medium text-ink">{plural(thanks!.paidCalls, "call")}</b>, with no account and no API key
                {thanks!.cameBack > 0 && (
                  <>
                    , and <b className="font-medium text-ink">{fmt.format(thanks!.cameBack)}</b> came back on another day
                  </>
                )}
                .{thanks!.privateCalls > 0 && <> {plural(thanks!.privateCalls, "call")} more were paid privately through Gloam, so we can&apos;t count who.</>}{" "}
              </>
            ) : (
              <>Every paid call is a vote that this is worth doing. </>
            )}
            You are the reason the rest of this page exists.
          </p>
          <ol className="mt-6 border-l border-line">
            {FIRSTS.map((f) => (
              <li key={f.when} className="relative pb-5 pl-6 last:pb-0">
                <span aria-hidden className="absolute top-1.5 -left-[5px] size-2.5 rounded-full bg-brand" />
                <p className="font-mono text-xs tracking-wide text-faint uppercase">{f.when}</p>
                <p className="mt-1 text-ink">{f.what}</p>
                <p className="mt-0.5 text-sm">{f.who}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm">
            The live counts for each API are on the{" "}
            <Link href="/numbers" className={link}>
              Numbers page
            </Link>
            .
          </p>
        </Letter>

        <Letter n={2} to="The people who launched an API">
          <p>
            {thanks !== null && thanks.apis > 0 ? (
              <>
                <b className="font-medium text-ink">{plural(thanks.apis, "API")}</b> {thanks.apis === 1 ? "is" : "are"} live today.{" "}
              </>
            ) : null}
            Putting a price on your work and letting strangers&apos; agents pay for it takes some trust. Thank you for
            giving it early.
          </p>
          <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/projects" className={link}>
              See the APIs
            </Link>
            <Link href="/dashboard" className={link}>
              Launch your own
            </Link>
          </p>
        </Letter>

        <Letter n={3} to="The teams building with us">
          <p>
            <b className="font-medium text-ink">{plural(PARTNERS.length, "team")}</b> added something Autonomo couldn&apos;t
            have built alone: private payments, credit, jobs, proofs, records and wallets.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
            {PARTNERS.map((p) => (
              <a key={p.name} href={p.href} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-3 bg-bg p-4 no-underline hover:bg-surface">
                <span className="font-mono text-[0.65rem] tracking-wide text-faint uppercase">{p.what}</span>
                <PartnerMark partner={p} className="h-6 w-auto" />
              </a>
            ))}
            {/* Empty cells that finish the last row, two across on phones and four across from there up. */}
            {Array.from({ length: (4 - (PARTNERS.length % 4)) % 4 }, (_, i) => (
              <div key={`fill-${i}`} aria-hidden className={`bg-bg ${i < PARTNERS.length % 2 ? "" : "hidden sm:block"}`} />
            ))}
          </div>
          <p className="mt-4 text-sm">
            What each one adds is on the{" "}
            <Link href="/partners" className={link}>
              Partners page
            </Link>
            .
          </p>
        </Letter>

        <Letter n={4} to="Everyone following along">
          <p>
            To the people who hold {TOKEN.symbol}, report what&apos;s broken, ask hard questions and tell us what to build
            next. Come say hello.
          </p>
          <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <a href="https://x.com/useautonomo" className={link}>
              X
            </a>
            <a href="https://t.me/autonomodotfun" className={link}>
              Telegram
            </a>
          </p>
        </Letter>
      </div>

      {/* The sign-off */}
      <section className="mt-12 rounded-lg bg-brand px-6 py-10 text-on-brand sm:px-10 sm:py-14">
        <p className="font-mono text-xs tracking-[0.14em] uppercase">From the Autonomo team</p>
        <p className="heading mt-3 text-5xl leading-[0.95] sm:text-7xl">Happy Thanksgiving.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/projects" className="rounded-md bg-on-brand px-5 py-2.5 text-sm font-semibold tracking-wide text-brand uppercase no-underline hover:opacity-90">
            Explore the APIs
          </Link>
          <Link href="/dashboard" className="rounded-md border border-on-brand px-5 py-2.5 text-sm font-semibold tracking-wide uppercase no-underline hover:bg-on-brand/10">
            Launch your API
          </Link>
        </div>
      </section>

      <p className="mt-6 max-w-3xl text-xs text-faint">
        The numbers update every hour. A wallet is counted once, however many APIs it paid. An API&apos;s own wallets
        aren&apos;t counted as payers, and the Playground and the Telegram bot pay from one wallet, so they count as one.
      </p>
    </div>
  );
}

/** One thank-you: its number and who it is to on the left, the words on the right. */
function Letter({ n, to, children }: { n: number; to: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-b border-line py-10 lg:grid-cols-[20rem_minmax(0,1fr)] lg:py-12">
      <div>
        <p className="font-mono text-xs text-accent">0{n} / To</p>
        <h2 className="heading mt-2 text-3xl leading-none sm:text-4xl">{to}</h2>
      </div>
      <div className="max-w-2xl text-muted">{children}</div>
    </section>
  );
}
