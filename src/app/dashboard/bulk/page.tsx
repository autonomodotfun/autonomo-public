import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { secretsEnabled } from "@/lib/gateway";
import { currentOwner } from "@/lib/session";
import { BulkForm } from "./bulk-form";

export const metadata: Metadata = { title: "Launch several APIs", robots: { index: false } };

export default async function BulkLaunchPage() {
  const owner = await currentOwner();
  if (!owner) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 sm:px-6">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">← Your APIs</Link>
      <h1 className="heading mt-3 text-4xl">Launch several at once</h1>
      <p className="mt-2 text-muted">
        For APIs that live at one address. Enter the address and key once, list the APIs, and we check and launch them
        together. Each one gets its own paid address and price.{" "}
        <Link href="/dashboard/new" className="underline hover:text-ink">Launching just one?</Link>
      </p>
      <div className="mt-8">
        <BulkForm site={process.env.NEXT_PUBLIC_SITE_URL ?? ""} secretsEnabled={secretsEnabled()} />
      </div>
    </div>
  );
}
