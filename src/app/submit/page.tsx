import type { Metadata } from "next";
import { SubmitForm } from "./submit-form";

export const metadata: Metadata = {
  title: "Launch your API",
  description: "Launch an x402 API on Autopad so AI agents can find it and pay for it per call.",
};

type Props = { searchParams: Promise<{ claim?: string }> };

export default async function SubmitPage({ searchParams }: Props) {
  const { claim } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 pt-12 sm:px-6">
      <h1 className="heading text-4xl">{claim ? "Suggest an edit" : "Launch your API"}</h1>
      <p className="mt-3 text-muted">
        {claim ? (
          <>Send the corrected details for <span className="font-mono text-ink">{claim}</span> and we&apos;ll update the listing.</>
        ) : (
          <>
            Put your x402 endpoint in front of agents that pay per call. Services registered with a Bazaar-enabled
            facilitator launch automatically. Use this form for anything else: a new API, an agent, an SDK, a tool or a
            wallet.
          </>
        )}
      </p>
      <div className="mt-8">
        <SubmitForm claim={claim?.slice(0, 80)} />
      </div>
    </div>
  );
}
