import { privyAppId } from "@/lib/privy-config";
import { Providers } from "./privy";

// Privy loads only on the dashboard, and only when it's configured.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return privyAppId ? <Providers appId={privyAppId}>{children}</Providers> : children;
}
