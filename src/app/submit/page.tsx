import type { Metadata } from "next";
import Link from "next/link";
import { SubmitForm } from "./submit-form";

export const metadata: Metadata = {
  title: "List your project",
  description: "List an x402 API, tool, SDK, wallet or agent on Autonomo so AI agents can find it and pay for it per call.",
};

type Props = { searchParams: Promise<{ claim?: string }> };

export default async function SubmitPage({ searchParams }: Props) {
  const { claim } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 pt-12 sm:px-6">
      <h1 className="heading text-4xl">{claim ? "Suggest an edit" : "List your project"}</h1>
      {claim ? (
        <p className="mt-3 text-muted">
          Send the corrected details for <span className="font-mono text-ink">{claim}</span> and we&apos;ll update the listing.
        </p>
      ) : (
        <>
          <p className="mt-3 text-muted">
            For an API that already takes x402 payments, and for tools, SDKs, wallets and agents. We review each one by
            hand and add it to the directory, where agents look for APIs to pay for.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            <li>
              <span className="font-medium text-ink">Your API doesn&apos;t take x402 payments yet?</span>{" "}
              <Link href="/dashboard" className="underline hover:text-ink">Launch it through us</Link> instead. No code needed.
            </li>
            <li>
              <span className="font-medium text-ink">Already in the Coinbase or PayAI x402 catalog?</span> We import
              both every 3 days, so you&apos;re added automatically and don&apos;t need this form.
            </li>
          </ul>
        </>
      )}
      <div className="mt-8">
        <SubmitForm claim={claim?.slice(0, 80)} />
      </div>
    </div>
  );
}
