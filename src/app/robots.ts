import type { MetadataRoute } from "next";

// "/projects?" blocks the filter, sort and page combinations of the directory, which crawlers like GPTBot
// otherwise walk by the hundreds of thousands a day. /projects itself and every /projects/<slug> stay crawlable.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/dashboard", "/x/", "/projects?"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
