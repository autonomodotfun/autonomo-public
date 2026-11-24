import type { Category } from "@/lib/constants";

export const CATEGORY_INFO: Record<Category, { label: string; plural: string; blurb: string }> = {
  service: { label: "Service", plural: "Paid services", blurb: "APIs and content you pay for per request" },
  agent: { label: "Agent", plural: "Agents", blurb: "Autonomous agents that buy or sell with x402" },
  facilitator: { label: "Facilitator", plural: "Facilitators", blurb: "Verify and settle payments on-chain" },
  sdk: { label: "SDK", plural: "SDKs", blurb: "Libraries for adding x402 to clients and servers" },
  extension: { label: "Extension", plural: "Extensions", blurb: "Identity, receipts, refunds and more" },
  tooling: { label: "Tooling", plural: "Tooling", blurb: "Dev tools, testing and monitoring" },
  wallet: { label: "Wallet", plural: "Wallets", blurb: "Wallets and payment clients for agents" },
  explorer: { label: "Explorer", plural: "Explorers & directories", blurb: "Track activity and find services" },
  infrastructure: { label: "Infrastructure", plural: "Infrastructure", blurb: "Platforms and networks supporting x402" },
};
