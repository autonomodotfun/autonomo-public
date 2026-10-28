import type { MetadataRoute } from "next";
import { CATEGORIES } from "@/lib/constants";
import { getAllSlugs } from "@/lib/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const slugs = await getAllSlugs();
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/projects`, changeFrequency: "daily", priority: 0.9 },
    ...CATEGORIES.map((c) => ({ url: `${base}/projects?category=${c}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...slugs.map((s) => ({ url: `${base}/projects/${s.slug}`, lastModified: s.updatedAt, priority: 0.6 })),
  ];
}
