import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API",
  description: "Free JSON API for agents to discover x402 APIs and Autonomo gateways.",
};

const ENDPOINTS = [
  {
    path: "/api/v1/projects",
    summary: "Search and filter projects.",
    params: [
      ["q", "Full-text search over name and description; also matches host and tags"],
      ["category", "service · agent · facilitator · sdk · extension · tooling · wallet · explorer · infrastructure"],
      ["network", "e.g. base, solana, polygon"],
      ["sort", "popular (default) · relevance · new · price · name"],
      ["page", "1-based page number"],
      ["limit", "Results per page, max 100 (default 30)"],
    ],
    example: "/api/v1/projects?q=weather&network=base&limit=5",
  },
  {
    path: "/api/v1/projects/{slug}",
    summary: "One project, with up to 500 of its paid endpoints (price, network, facilitator, 30-day calls).",
    params: [],
    example: "/api/v1/projects/cdp-facilitator",
  },
  {
    path: "/api/v1/stats",
    summary: "Totals, counts per category and the most common networks.",
    params: [],
    example: "/api/v1/stats",
  },
  {
    path: "/api/v1/gateways",
    summary:
      "Every live Autonomo gateway, including the official APIs: name, description, the URL to call, the path to append, accepted tokens and its project page. Used by the Autonomo MCP server.",
    params: [],
    example: "/api/v1/gateways",
  },
  {
    path: "/api/v1/pro/endpoints",
    paid: true,
    summary:
      "Paid per call with x402, in USDG or $AUTONOMO on Robinhood Chain. Answers 503 until it is switched on. Endpoint-level search with URL, method, price, network, asset, payTo, scheme, facilitator and 30-day calls. Testnet endpoints are excluded.",
    params: [
      ["q", "Search endpoint URLs and descriptions, and their project's text"],
      ["network", "e.g. base, solana, polygon"],
      ["maxPrice", "Only endpoints priced at or below this many USD"],
      ["sort", "popular (default) · price"],
      ["page", "1-based page number"],
      ["limit", "Results per page, max 200 (default 50)"],
    ],
    example: "/api/v1/pro/endpoints?q=weather&maxPrice=0.01&sort=price",
  },
];

export default function ApiDocs() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
      <h1 className="heading text-4xl">API</h1>
      <p className="mt-3 text-muted">
        Point your agent here to find APIs it can pay for. Read-only JSON, free while in beta. No key needed, CORS is
        open, and responses are cached for 5 minutes. The <Link href="/docs#pro" className="underline hover:text-ink">Pro API</Link>{" "}
        adds endpoint-level search, paid per call with x402.
      </p>
      <p className="mt-3 text-sm text-muted">
        To call and pay the APIs you find, use the{" "}
        <Link href="/docs#mcp" className="underline hover:text-ink">MCP server</Link> or an{" "}
        <Link href="/docs#agents" className="underline hover:text-ink">x402 client in your own code</Link>.
      </p>
      <p className="mt-3 text-sm text-muted">
        New to Autonomo? Start with the <Link href="/docs" className="underline hover:text-ink">docs</Link>.
      </p>
      <div className="mt-10 space-y-10">
        {ENDPOINTS.map((e) => (
          <section key={e.path}>
            <h2 className="font-mono text-sm">
              <span className="text-accent">GET</span> {e.path}
              {"paid" in e && (
                <Link href="/docs#pro" className="ml-2 rounded-sm bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-on-brand uppercase">
                  Paid · x402
                </Link>
              )}
            </h2>
            <p className="mt-2 text-muted">{e.summary}</p>
            {e.params.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <tbody className="divide-y divide-line">
                  {e.params.map(([name, desc]) => (
                    <tr key={name}>
                      <td className="w-24 py-2 align-top font-mono text-xs">{name}</td>
                      <td className="py-2 text-muted">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <a
              href={e.example}
              className="mt-4 block overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs hover:border-faint"
            >
              curl {process.env.NEXT_PUBLIC_SITE_URL ?? ""}
              {e.example}
            </a>
          </section>
        ))}
      </div>
    </div>
  );
}
