import { TOKEN } from "@/lib/constants";
import { DocsNav, type NavGroup } from "./docs-nav";

const NAV: NavGroup[] = [
  {
    title: "Start",
    items: [{ href: "/docs", label: "Docs home" }],
  },
  {
    title: "Launch an API",
    items: [
      { href: "/docs/launch", label: "Launch from the dashboard" },
      { href: "/docs/safe", label: "Get paid at a Safe" },
      { href: "/docs/self-hosted", label: "Run x402 yourself" },
    ],
  },
  {
    title: "Use APIs",
    items: [
      { href: "/docs/directory", label: "The x402 directory" },
      { href: "/docs/agents", label: "Use Autonomo from your agent" },
      { href: "/docs/sdk", label: "SDK for TypeScript and Python" },
      { href: "/docs/langchain", label: "Use Autonomo from LangChain" },
      { href: "/docs/official-apis", label: "Official APIs" },
      { href: "/docs/gloam", label: "Pay privately with Gloam" },
      { href: "/docs/borro", label: "Pay with a Borro credit line" },
      { href: "/docs/ostra", label: "Use Autonomo from Ostra" },
      { href: "/api-docs", label: "API reference" },
    ],
  },
  {
    title: "Token",
    items: [{ href: "/docs/token", label: `${TOKEN.symbol}, burn and Verified` }],
  },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-10 sm:px-6 lg:grid-cols-[14rem_1fr] lg:gap-10">
      <DocsNav groups={NAV} />
      {children}
    </div>
  );
}
