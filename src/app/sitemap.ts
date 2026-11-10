import type { MetadataRoute } from "next";
import { burnEnabled } from "@/lib/burn";
import { getAllSlugs } from "@/lib/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const slugs = await getAllSlugs();
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/projects`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/docs/launch`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/directory`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/agents`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/sdk`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/langchain`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/official-apis`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/token`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/docs/self-hosted`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/docs/safe`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/docs/gloam`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/docs/borro`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/docs/ostra`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/partners`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/numbers`, changeFrequency: "daily", priority: 0.5 },
    { url: `${base}/api-docs`, changeFrequency: "monthly", priority: 0.6 },
    ...(burnEnabled() ? [{ url: `${base}/burn`, changeFrequency: "daily" as const, priority: 0.7 }] : []),
    ...slugs.map((s) => ({ url: `${base}/projects/${s.slug}`, lastModified: s.updatedAt, priority: 0.6 })),
  ];
}
