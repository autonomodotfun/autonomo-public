import type { Metadata } from "next";
import Link from "next/link";
import { TOKEN } from "@/lib/constants";
import { verifiedAmount, verifiedEnabled } from "@/lib/verified";

export const metadata: Metadata = {
  title: "Get paid at a Safe",
  description: `Set up a Safe multisig on ${TOKEN.chainName} and have your Autonomo APIs pay it, while your own wallet keeps launching and managing them.`,
};

const SAFE_APP = "https://app.safe.global";

export default function SafeGuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <Link href="/docs#launch" className="text-sm text-muted hover:text-ink">
        ← Docs
      </Link>
      <p className="mt-6 font-mono text-xs tracking-wide text-accent uppercase">Guide</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">Get paid at a Safe</h1>

      <div className="docs-body mt-6 space-y-4">
        <p>
          A Safe is a multisig wallet: it needs several signatures, from wallets you choose, before any money leaves it.
          Your APIs can pay a Safe while the wallet you signed in with keeps launching and managing them. If someone gets
          into that one wallet, they still can&apos;t move your earnings.
        </p>
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          <Role
            title="Sign-in wallet"
            body="Signs in to the dashboard. Launches, prices, pauses and deletes your APIs. Unchanged by this guide."
          />
          <Role
            title="Safe"
            body={`Gets paid for every call, in USDG or ${TOKEN.symbol}${verifiedEnabled() ? ", and holds the tokens for Verified" : ""}. It can't sign in.`}
          />
        </div>

        <Section title="Before you start">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Two or more wallets that will sign for the Safe, each with its own key. A hardware wallet and a phone wallet
              is a good pair. Keep them apart: if one device holds every key, the Safe is no safer than one wallet.
            </li>
            <li>A little ETH on {TOKEN.chainName} in one of them, to pay the gas for creating the Safe.</li>
            <li>
              {TOKEN.chainName} added to that wallet (chain ID <code>{TOKEN.chainId}</code>, RPC{" "}
              <code>{TOKEN.rpcUrl}</code>).
            </li>
            <li>At least one API launched from the <Link href="/dashboard">dashboard</Link>.</li>
          </ul>
        </Section>

        <Section title="Create the Safe">
          <Step n={1} title="Open Safe and connect a signer">
            <p>
              Go to <a href={SAFE_APP}>app.safe.global</a> and connect one of your signer wallets. Check the address bar
              first: there are fake copies of the Safe app.
            </p>
          </Step>
          <Step n={2} title={`Create an account on ${TOKEN.chainName}`}>
            <p>
              Choose <b>Create account</b>, give it a name you&apos;ll recognize and pick <b>{TOKEN.chainName}</b> as the
              network. The Safe only exists on the network you pick, so make sure it&apos;s this one: your APIs are paid on{" "}
              {TOKEN.chainName}.
            </p>
          </Step>
          <Step n={3} title="Add signers and choose the threshold">
            <p>
              Add the address of each signer wallet, then choose how many must sign to move money. We recommend{" "}
              <b>2 of 3</b>: any two of your wallets can move funds, and you can still get in if you lose one. With 2 of 2,
              losing either wallet locks the money in for good. A threshold of 1 isn&apos;t a multisig, and the dashboard won&apos;t
              accept it.
            </p>
          </Step>
          <Step n={4} title="Create it">
            <p>
              Review the network, signers and threshold, then create the Safe and confirm the transaction in your wallet.
              That pays the gas once. When it&apos;s done, Safe shows the new account.
            </p>
          </Step>
          <Step n={5} title="Copy the Safe's address">
            <p>
              Copy the address from the top of the Safe app. It may start with a short network name and a colon; use only
              the part from <code>0x</code> on. You can check it on{" "}
              <a href={TOKEN.explorer}>Blockscout</a>, where it should show as a contract.
            </p>
          </Step>
        </Section>

        <Section title="Point your APIs at it">
          <Step n={6} title="Check it on the dashboard">
            <p>
              Sign in to the <Link href="/dashboard">dashboard</Link> with your usual wallet, paste the Safe&apos;s address
              under <b>Where your APIs get paid</b> and choose <b>Check Safe</b>. We read it from {TOKEN.chainName} and
              show its signers and threshold. Make sure they&apos;re your wallets. A Safe that isn&apos;t on{" "}
              {TOKEN.chainName}, or that needs only one signature, is turned down.
            </p>
          </Step>
          <Step n={7} title="Sign with your sign-in wallet">
            <p>
              Choose <b>Sign and set Safe</b> and sign the message in the wallet you signed in with. It&apos;s free and
              doesn&apos;t send a transaction. It proves the change comes from your wallet, not only from someone using
              your login, and it applies straight away. If you signed in with email, Google or X, the wallet Autonomo
              created for you signs it.
            </p>
          </Step>
          <Step n={8} title="See it working">
            <p>
              Your dashboard now shows the Safe under <b>Payments go to</b>, every API&apos;s page says it pays
              the Safe, and the <code>402</code> answer from your gateway names it as <code>payTo</code>. It covers all your
              APIs, including ones you launch later. Payments already made stay where they went.
            </p>
          </Step>
        </Section>

        {verifiedEnabled() && (
          <Section title="Verified">
            <p>
              Once your APIs pay a Safe, Verified looks at the Safe&apos;s balance instead of your sign-in wallet. To keep
              the badge, move about {verifiedAmount()} of {TOKEN.symbol} into the Safe before you set it.
              Moving tokens out of the Safe later can drop the badge, the same as with any wallet.
            </p>
          </Section>
        )}

        <Section title="Spending from the Safe">
          <p>
            To send money out, open the Safe in the Safe app, start a transaction, and have enough signers confirm it in
            their own wallets. The last one to sign executes it and pays a little ETH for gas. Agents and Autonomo never
            need any of this: they only send payments in.
          </p>
        </Section>

        <Section title="Questions">
          <dl className="divide-y divide-line border-y border-line">
            {FAQ.map(([q, a]) => (
              <div key={q} className="py-4">
                <dt className="font-medium">{q}</dt>
                <dd className="mt-1 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </div>
  );
}

const FAQ: [string, React.ReactNode][] = [
  [
    "Can I sign in with the Safe?",
    <>No. A Safe can&apos;t sign a message the way a normal wallet does, so keep signing in with the wallet you launched with.</>,
  ],
  [
    "Does Autonomo get access to the Safe?",
    <>No. Autonomo only writes the Safe&apos;s address into your APIs&apos; payment details. Only your signers can move what&apos;s in it.</>,
  ],
  [
    "Can my sign-in wallet also be a signer?",
    <>Yes, but then losing that one wallet costs you a signer as well as your sign-in, so a 2 of 3 Safe is worth it.</>,
  ],
  [
    "Can I change the Safe later?",
    <>Yes. Once your APIs pay a Safe, that Safe holds your earnings, so moving them somewhere else is checked by hand: request the new Safe from the dashboard, and we may ask you to confirm it on <a href="https://t.me/autonomodotfun">Telegram</a> or <a href="https://x.com/useautonomo">X</a>. Until it&apos;s approved, your APIs keep paying the Safe you have. To go back to your sign-in wallet, ask us on Telegram.</>,
  ],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 pt-8">
      <h2 className="heading text-2xl">{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 pt-1">
      <h3 className="flex items-baseline gap-2 font-medium">
        <span className="font-mono text-xs text-accent">0{n}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Role({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-bg p-4">
      <span className="font-medium text-ink">{title}</span>
      <span className="mt-1 block text-sm text-muted">{body}</span>
    </div>
  );
}
