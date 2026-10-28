import type { Category } from "../lib/constants";

// Hand-checked ecosystem entries. Sources: docs.x402.org/dev-tools/* and the coinbase/x402 README (Oct 2026).
export type CuratedProject = {
  slug: string;
  name: string;
  category: Category;
  description: string;
  website: string;
  github?: string;
  docs?: string;
  host?: string; // links Bazaar-imported endpoints on this host to the entry
  networks?: string[];
  tags?: string[];
  featured?: boolean;
};

export const curated: CuratedProject[] = [
  // --- Facilitators ---
  {
    slug: "cdp-facilitator",
    name: "Coinbase CDP Facilitator",
    category: "facilitator",
    description:
      "Coinbase-hosted facilitator that verifies and settles x402 payments, with KYT and OFAC screening on each transaction. Also runs the CDP Bazaar discovery catalog.",
    website: "https://docs.cdp.coinbase.com/x402/docs/quickstart-sellers",
    networks: ["base", "solana"],
    tags: ["coinbase", "bazaar", "compliance"],
    featured: true,
  },
  {
    slug: "payai-facilitator",
    name: "PayAI Facilitator",
    category: "facilitator",
    description:
      "Production facilitator that works across many networks and tokens without API keys. Exposes a public discovery endpoint listing the resources it settles for.",
    website: "https://facilitator.payai.network",
    tags: ["multi-network", "bazaar", "no-api-key"],
    featured: true,
  },
  {
    slug: "x402-org-facilitator",
    name: "x402.org Facilitator",
    category: "facilitator",
    description:
      "Zero-setup public facilitator run for the x402 project. Meant for testnet development and quickstarts, not mainnet traffic.",
    website: "https://x402.org",
    networks: ["base-sepolia"],
    tags: ["testnet", "quickstart"],
  },
  {
    slug: "built-on-stellar-facilitator",
    name: "Built on Stellar",
    category: "facilitator",
    description: "Free public facilitator for x402 payments on the Stellar network.",
    website: "https://developers.stellar.org/docs/build/apps/x402/built-on-stellar",
    networks: ["stellar"],
    tags: ["stellar", "free"],
  },
  {
    slug: "celo-facilitator",
    name: "Celo Facilitator",
    category: "facilitator",
    description:
      "Gasless facilitator for Celo mainnet and Celo Sepolia. Accepts USDC, USD₮ and USA₮ via EIP-3009, and regional stablecoins (wARS, wBRL, wCOP) via Permit2.",
    website: "https://x402.celo.org",
    networks: ["celo", "celo-sepolia"],
    tags: ["gasless", "stablecoins", "permit2"],
  },
  {
    slug: "corbits",
    name: "Corbits",
    category: "facilitator",
    description: "Production facilitator supporting multiple EVM networks, Solana and a range of tokens.",
    website: "https://corbits.dev",
    networks: ["base", "solana"],
    tags: ["multi-network"],
  },
  {
    slug: "dexter",
    name: "Dexter",
    category: "facilitator",
    description: "Free public facilitator for Solana and EVM chains. No fees and no account needed.",
    website: "https://dexter.cash/facilitator",
    networks: ["solana", "base"],
    tags: ["free", "no-account"],
  },
  {
    slug: "fireblocks-facilitator",
    name: "Fireblocks Facilitator",
    category: "facilitator",
    description:
      "Open-source and hosted facilitator that settles through Fireblocks vaults, so signing keys never leave Fireblocks custody.",
    website: "https://developers.fireblocks.com/docs/x402-facilitator-overview",
    tags: ["custody", "institutional", "open-source"],
  },
  {
    slug: "ftp-canton-facilitator",
    name: "FTP Canton Facilitator",
    category: "facilitator",
    description: "Production facilitator on Canton Network mainnet for Canton Coin and CIP-56 tokens.",
    website: "https://www.ftptech.xyz/x402",
    networks: ["canton"],
    tags: ["canton"],
  },
  {
    slug: "hpp-facilitator",
    name: "HPP Facilitator",
    category: "facilitator",
    description: "Gasless public facilitator for HPP mainnet and Sepolia.",
    website: "https://docs.hpp.io/x402/facilitator",
    networks: ["hpp"],
    tags: ["gasless"],
  },
  {
    slug: "meridian",
    name: "Meridian",
    category: "facilitator",
    description: "Multi-chain facilitator with features aimed at developers.",
    website: "https://mrdn.finance",
    tags: ["multi-network"],
  },
  {
    slug: "mogami-facilitator",
    name: "Mogami Facilitator",
    category: "facilitator",
    description: "Free facilitator for Base, with an optional self-hosted Docker deployment.",
    website: "https://facilitator.mogami.tech",
    networks: ["base"],
    tags: ["free", "self-hosted", "docker"],
  },
  {
    slug: "near-x402-facilitator",
    name: "NEAR x402 Facilitator",
    category: "facilitator",
    description:
      "Independent open-source facilitator for NEAR and Base (Circle USDC, exact scheme) with sponsored gas and settlement recovery.",
    website: "https://x402.mikedotexe.com/",
    networks: ["near", "base"],
    tags: ["near", "open-source", "sponsored-gas"],
  },
  {
    slug: "polygon-facilitator",
    name: "Polygon Facilitator",
    category: "facilitator",
    description: "Production facilitator for Polygon mainnet and the Amoy testnet.",
    website: "https://docs.polygon.technology/payment-services/agentic-payments/x402/intro/",
    networks: ["polygon", "polygon-amoy"],
    tags: ["polygon"],
  },
  {
    slug: "solvador",
    name: "Solvador",
    category: "facilitator",
    description: "Facilitator covering EVM, Solana and NEAR, with support for several schemes and extensions.",
    website: "https://solvador.com",
    networks: ["base", "solana", "near"],
    tags: ["multi-network"],
  },
  {
    slug: "t54-xrpl-facilitator",
    name: "T54 XRPL Facilitator",
    category: "facilitator",
    description: "Production facilitator for the XRP Ledger, settling in XRP and RLUSD on mainnet and testnet.",
    website: "https://xrpl-x402.t54.ai",
    networks: ["xrpl"],
    tags: ["xrpl", "rlusd"],
  },

  // --- SDKs ---
  {
    slug: "x402-reference-sdks",
    name: "x402 reference SDKs",
    category: "sdk",
    description:
      "The reference implementation of the protocol: TypeScript packages (@x402/core, fetch/axios clients, Express/Hono/Fastify/Next servers, MCP, paywall), plus Python, Go and Java.",
    website: "https://docs.x402.org",
    github: "https://github.com/coinbase/x402",
    docs: "https://docs.x402.org/getting-started/quickstart-for-sellers",
    tags: ["typescript", "python", "go", "java", "official"],
    featured: true,
  },
  {
    slug: "mogami-java",
    name: "Mogami (Java)",
    category: "sdk",
    description: "Community Java stack for building x402 clients and servers.",
    website: "https://mogami.gitbook.io/mogami",
    github: "https://github.com/mogami-tech/",
    tags: ["java"],
  },
  {
    slug: "x402-rs",
    name: "x402-rs",
    category: "sdk",
    description: "Community Rust toolkit for x402, including client, server and facilitator pieces.",
    website: "https://github.com/x402-rs/x402-rs",
    github: "https://github.com/x402-rs/x402-rs",
    tags: ["rust"],
  },
  {
    slug: "x402-rails",
    name: "x402-rails",
    category: "sdk",
    description: "Ruby on Rails library for charging for routes with x402, maintained by Quicknode.",
    website: "https://github.com/quiknode-labs/x402-rails",
    github: "https://github.com/quiknode-labs/x402-rails",
    tags: ["ruby", "rails", "quicknode"],
  },

  // --- Extensions ---
  {
    slug: "world-agentkit",
    name: "World AgentKit",
    category: "extension",
    description: "Lets services check that a paying agent is backed by a verified human.",
    website: "https://docs.world.org/agents/agent-kit/integrate",
    tags: ["identity", "proof-of-human"],
  },
  {
    slug: "omatrust",
    name: "OMATrust",
    category: "extension",
    description: "Key authorizations for signed x402 offers and receipts.",
    website: "https://www.omatrust.org/x402",
    tags: ["signatures", "receipts"],
  },
  {
    slug: "peac-protocol",
    name: "PEAC Protocol",
    category: "extension",
    description: "Issues verifiable receipts for x402 payments.",
    website: "https://x402.peacprotocol.org",
    tags: ["receipts"],
  },
  {
    slug: "x402r",
    name: "x402r",
    category: "extension",
    description: "Non-custodial refunds and arbitration for x402 payments.",
    website: "https://x402r.org",
    tags: ["refunds", "disputes"],
  },
  {
    slug: "zauth",
    name: "zauth",
    category: "extension",
    description: "SDK for monitoring x402 endpoints, verifying responses and issuing refunds.",
    website: "https://zauthx402.com",
    tags: ["monitoring", "refunds"],
  },
  {
    slug: "x402aff",
    name: "x402aff",
    category: "extension",
    description: "Splits revenue with affiliates using x402 builder codes.",
    website: "https://github.com/MiroShark/x402aff",
    github: "https://github.com/MiroShark/x402aff",
    tags: ["affiliates", "builder-codes"],
  },

  // --- Explorers and directories ---
  {
    slug: "x402scan",
    name: "x402scan",
    category: "explorer",
    description: "Explorer for x402 activity: servers, transactions and facilitators.",
    website: "https://x402scan.com",
    tags: ["analytics", "explorer"],
  },
  {
    slug: "agentic-market",
    name: "Agentic.Market",
    category: "explorer",
    description: "Marketplace for discovering services that agents can pay for with x402.",
    website: "https://agentic.market",
    tags: ["marketplace"],
  },
  {
    slug: "pay-sh",
    name: "Pay.sh",
    category: "explorer",
    description: "Community-maintained directory of x402 services.",
    website: "https://pay.sh",
    tags: ["directory"],
  },
  {
    slug: "ampersend",
    name: "Ampersend",
    category: "explorer",
    description: "Discovery page for x402 services in the Ampersend app.",
    website: "https://app.ampersend.ai/discover",
    tags: ["directory"],
  },
  {
    slug: "x402-list",
    name: "x402-list",
    category: "explorer",
    description: "Community list of x402 projects and services.",
    website: "https://x402-list.com",
    tags: ["directory"],
  },
];
