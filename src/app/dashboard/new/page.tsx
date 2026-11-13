import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ownerPayTo, secretsEnabled } from "@/lib/gateway";
import { currentOwner } from "@/lib/session";
import { VerifiedPanel } from "@/components/verified";
import { burnPercent } from "@/lib/burn";
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
        Three short steps. We give your API a paid address: an agent pays for a call there, and we pass the call on to
        your API. Nothing changes on your side.{" "}
        <Link href="/docs/launch" className="underline hover:text-ink">Read the launch guide</Link>.
      </p>
      <div className="mt-8">
        <GatewayForm site={process.env.NEXT_PUBLIC_SITE_URL ?? ""} secretsEnabled={secretsEnabled()} burnPercent={burnPercent()} />
      </div>
      {/* Optional, so it sits after the form: nobody needs it to launch. */}
      <VerifiedPanel owner={(await ownerPayTo(owner)) ?? owner} className="mt-12" />

    </div>
  );
}
