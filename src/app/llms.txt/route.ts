import type { Metadata } from "next";
import { BURN_BPS, burnFactory } from "@/lib/burn";
import { TOKEN } from "@/lib/constants";
import { GATEWAY_USAGE } from "@/lib/playground";
import { listAutonomoGateways } from "@/lib/queries";
import { metadata as agents } from "../docs/agents/page";
import { metadata as borro } from "../docs/borro/page";
import { metadata as cli } from "../docs/cli/page";
import { metadata as directory } from "../docs/directory/page";
import { metadata as gloam } from "../docs/gloam/page";
import { metadata as langchain } from "../docs/langchain/page";
import { metadata as launch } from "../docs/launch/page";
import { metadata as officialApis } from "../docs/official-apis/page";
import { metadata as ostra } from "../docs/ostra/page";
import { metadata as docs } from "../docs/page";
import { metadata as safe } from "../docs/safe/page";
import { metadata as sdk } from "../docs/sdk/page";
import { metadata as selfHosted } from "../docs/self-hosted/page";
import { metadata as token } from "../docs/token/page";
import { metadata as apiDocs } from "../api-docs/page";
import { metadata as burn } from "../burn/page";
import { metadata as numbers } from "../numbers/page";
import { metadata as partners } from "../partners/page";
import { metadata as playground } from "../playground/page";
import { metadata as roadmap } from "../roadmap/page";

// /llms.txt (https://llmstxt.org): a plain-text map of Autonomo for AI agents and LLMs. Nothing here is written twice:
// page titles and descriptions come from each page's own metadata, the official APIs and their prices from the same
// gateway list the MCP server reads (/api/v1/gateways), and the token, chain and burn rate from the shared constants.
// A new docs page needs one line in DOCS below.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://autonomo.fun").replace(/\/+$/, "");

type Page = { path: string; meta: Metadata };

const DOCS: Page[] = [
  { path: "/docs", meta: docs },
  { path: "/docs/agents", meta: agents },
  { path: "/docs/sdk", meta: sdk },
  { path: "/docs/cli", meta: cli },
  { path: "/docs/langchain", meta: langchain },
  { path: "/docs/official-apis", meta: officialApis },
  { path: "/api-docs", meta: apiDocs },
  { path: "/docs/gloam", meta: gloam },
  { path: "/docs/borro", meta: borro },
  { path: "/docs/ostra", meta: ostra },
  { path: "/docs/launch", meta: launch },
  { path: "/docs/self-hosted", meta: selfHosted },
  { path: "/docs/safe", meta: safe },
  { path: "/docs/directory", meta: directory },
  { path: "/docs/token", meta: token },
];

const OPTIONAL: Page[] = [
  { path: "/playground", meta: playground },
  { path: "/numbers", meta: numbers },
  ...(burnFactory() ? [{ path: "/burn", meta: burn }] : []),
  { path: "/roadmap", meta: roadmap },
  { path: "/partners", meta: partners },
];

const titleOf = (m: Metadata) => (typeof m.title === "string" ? m.title : "");
const link = ({ path, meta }: Page) => `- [${titleOf(meta)}](${SITE}${path}): ${meta.description ?? ""}`;
const amount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });
/** Gateway descriptions are typed by their creators; end each with a period so the next sentence doesn't run on. */
const sentence = (s: string | null) => {
  const t = (s ?? "").trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
};

const LIST_FALLBACK = `- The live list, with prices and the path to call, is at ${SITE}/api/v1/gateways.`;

async function officialApiLines() {
  try {
    const gateways = await listAutonomoGateways();
    if (gateways.length === 0) return [LIST_FALLBACK];
    return gateways.map((g) => {
      const prices = [
        g.autonomoAmount === null ? null : `${amount(Number(g.autonomoAmount))} ${TOKEN.symbol}`,
        g.acceptUsdg ? `${amount(Number(g.priceUsd))} USDG` : null,
      ].filter(Boolean);
      const usage = GATEWAY_USAGE[g.slug] ?? "/";
      return `- [${g.name}](${SITE}/projects/${g.projectSlug}): ${sentence(g.description)} Call \`GET ${SITE}/x/${g.slug}${usage}\`. Price per call: ${prices.join(" or ")}.`;
    });
  } catch (e) {
    console.error("llms.txt gateway list failed", e);
    return [LIST_FALLBACK];
  }
}

export async function GET() {
  const apis = await officialApiLines();
  const burnLine = burnFactory()
    ? `- ${BURN_BPS / 100}% of every payment through a hosted gateway buys back and burns ${TOKEN.symbol}. Every burn is listed at ${SITE}/burn.\n`
    : "";

  const text = `# Autonomo

> Autonomo is the agentic x402 launchpad and directory. API creators put a price on an API and AI agents pay for each call over x402, in USDG or ${TOKEN.symbol} on ${TOKEN.chainName}, with no API keys or accounts: just a wallet. Autonomo also lists x402 APIs from across the ecosystem and runs its own official APIs for ${TOKEN.chainName}.

Key facts:

- Chain: ${TOKEN.chainName}, chain ID ${TOKEN.chainId} (x402 network \`${TOKEN.network}\`). Explorer: ${TOKEN.explorer}
- ${TOKEN.symbol} contract: \`${TOKEN.address}\` (${TOKEN.decimals} decimals). This is the only official address.
- Each hosted gateway takes USDG, ${TOKEN.symbol} or both, as its creator chooses; the prices below show which. Self-hosted APIs in the directory use whatever their own facilitator supports, most often USDC on Base.
- Autonomo's facilitator settles each gateway payment on-chain and pays the gas. Paying in ${TOKEN.symbol} needs a one-time Permit2 approval, which costs a little ETH.
${burnLine}- The discovery API is free JSON, with no key and open CORS.

## Call an API

1. Find one: \`GET ${SITE}/api/v1/gateways\` lists every live Autonomo gateway with its URL, the path to append and its prices. \`GET ${SITE}/api/v1/projects?q=<search>\` searches the whole x402 directory.
2. Call it: \`GET ${SITE}/x/<slug><path>\`. Without a payment the gateway answers HTTP 402, with what it accepts in the \`PAYMENT-REQUIRED\` header (x402 version 2, scheme \`exact\`).
3. Pay: sign the payment with an x402 client (for example \`@x402/fetch\` with \`@x402/evm\`) and send the same request again with it in the \`PAYMENT-SIGNATURE\` header (\`X-PAYMENT\` also works). A call whose API fails is not charged.

Or use one of Autonomo's tools, which do all three steps within a per-call cap and a daily budget:

- MCP server (Claude, Cursor, Codex and other MCP clients): \`npx -y autonomo-mcp\` with \`AUTONOMO_WALLET_KEY\` set to a dedicated agent wallet. Tools: \`find_apis\` and \`get_price\` (free), \`call_api\` (pays). Guide: ${SITE}/docs/agents#mcp
- SDK: \`npm install autonomo-sdk\` or \`pip install autonomo-sdk\`. One \`call\` finds the API, pays and returns the answer with a receipt. Guide: ${SITE}/docs/sdk
- CLI: \`npx autonomo-sdk find "<what you need>"\`, then \`npx autonomo-sdk call "<what you need>"\`. Add \`--dry-run\` to see the price without paying. Guide: ${SITE}/docs/cli
- LangChain and LangGraph: \`pip install langchain-autonomo\` or \`npm install langchain-autonomo\`. Guide: ${SITE}/docs/langchain

Use a new wallet with a small balance for an agent, never a main wallet.

## Live APIs

Every API live on an Autonomo gateway right now, including Autonomo's official APIs for ${TOKEN.chainName} (see ${SITE}/docs/official-apis). In paths, replace \`<…>\` with your value.

${apis.join("\n")}

## Docs

${DOCS.map(link).join("\n")}

## Discovery API

- \`GET ${SITE}/api/v1/gateways\`: every live Autonomo gateway, with prices, the path to call, Verified status and track record.
- \`GET ${SITE}/api/v1/projects\`: search the x402 directory. Parameters: \`q\`, \`category\`, \`network\`, \`sort\` (popular, relevance, new, price, name), \`page\`, \`limit\` (max 100).
- \`GET ${SITE}/api/v1/projects/{slug}\`: one project with up to 500 of its paid endpoints.
- \`GET ${SITE}/api/v1/stats\`: totals, counts per category and the most common networks.

## Optional

${OPTIONAL.map(link).join("\n")}
- [Directory](${SITE}/projects): every x402 project Autonomo tracks, with live prices and usage.
`;

  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
