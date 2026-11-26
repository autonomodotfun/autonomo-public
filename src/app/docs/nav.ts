// The docs menu, in one place. The side menu, the docs home's tiles, the group label above each guide's title and the
// previous / next links all read this list, so a new guide is added once, here.

export type NavItem = {
  href: string;
  label: string;
  /** One line for the docs home's tiles. */
  about?: string;
};
export type NavGroup = { title: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    title: "Start",
    items: [
      { href: "/docs", label: "Docs home" },
      { href: "/docs/quickstart", label: "Quickstart", about: "Your first paid call, in three steps." },
      { href: "/docs/x402", label: "How x402 works", about: "How an agent pays inside a normal HTTP request." },
      { href: "/docs/faq", label: "FAQ", about: "Fees, hosting, networks and wallet safety." },
    ],
  },
  {
    title: "Build an agent",
    items: [
      { href: "/docs/agents", label: "Overview", about: "Every way an agent can find and pay for APIs." },
      { href: "/docs/sdk", label: "SDK", about: "TypeScript and Python. One call finds an API and pays." },
      { href: "/docs/cli", label: "CLI", about: "From your terminal, with dry runs and spending limits." },
      { href: "/docs/agents#mcp", label: "MCP server", about: "For Claude, Cursor, Codex and other MCP clients." },
      { href: "/docs/agents#skill", label: "Agent skill", about: "One file that teaches your agent to find and pay for APIs." },
    ],
  },
  {
    title: "Frameworks",
    items: [
      { href: "/docs/langchain", label: "LangChain", about: "Tools for LangChain and LangGraph, in Python and TypeScript." },
      { href: "/docs/eliza", label: "elizaOS", about: "A plugin for elizaOS agents, on 1.x and 2.x." },
    ],
  },
  {
    title: "Ways to pay",
    items: [
      { href: "/docs/gloam", label: "Privately, with Gloam", about: "The payment doesn't link back to the agent's wallet." },
      { href: "/docs/borro", label: "On credit, with Borro", about: "Borrow what the wallet is short and pay in the same request." },
      { href: "/docs/qwallet", label: "Savings in a QWallet", about: "Keep savings behind two keys and pay from a small wallet." },
    ],
  },
  {
    title: "Agent jobs",
    items: [{ href: "/docs/tokyo-futuro", label: "Tokyo Futuro", about: "Find open paid jobs your agent can take, with the Job Finder." }],
  },
  {
    title: "Launch an API",
    items: [
      { href: "/docs/launch", label: "From the dashboard", about: "No code: a hosted gateway in front of your API." },
      { href: "/docs/safe", label: "Get paid at a Safe", about: "Send your earnings to a multisig." },
      { href: "/docs/self-hosted", label: "Run x402 yourself", about: "Add x402 to your own server and get listed." },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/official-apis", label: "Official APIs", about: "The APIs Autonomo runs, and the wallets behind them." },
      { href: "/docs/directory", label: "The directory", about: "What's in it, how to search it and where the data comes from." },
      { href: "/api-docs", label: "API reference", about: "The free discovery API: every endpoint and parameter." },
      { href: "/docs/token", label: "Token, burn and Verified", about: "The address, the burn on paid calls and the Verified badge." },
    ],
  },
];

export const group = (title: string) => NAV.find((g) => g.title === title)?.items ?? [];
