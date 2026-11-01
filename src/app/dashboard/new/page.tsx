import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { secretsEnabled } from "@/lib/gateway";
import { currentOwner } from "@/lib/session";
import { VerifiedPanel } from "@/components/verified";
import { GatewayForm } from "../gateway-form";

export const metadata: Metadata = { title: "Launch an API", robots: { index: false } };

export default async function NewGatewayPage() {
  const owner = await currentOwner();
  if (!owner) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 sm:px-6">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Your APIs</Link>
      <h1 className="heading mt-3 text-4xl">Launch an API</h1>
      <p className="mt-2 text-muted">
        Autonomo puts your API behind an x402 paywall. Agents pay per call, then the request is forwarded to your API.
      </p>
      <VerifiedPanel owner={owner} className="mt-6" />
      <div className="mt-8">
        <GatewayForm site={process.env.NEXT_PUBLIC_SITE_URL ?? ""} secretsEnabled={secretsEnabled()} />
      </div>
    </div>
  );
}
