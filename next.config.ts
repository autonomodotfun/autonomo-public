import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // The ERC-8004 agent registration file, readable from agent explorers in the browser.
  async headers() {
    return [{ source: "/.well-known/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
  // A retired official API's project page goes to the API that replaced it (src/lib/retired.ts), so old links land
  // somewhere useful. retired.test.ts checks this list against that file.
  async redirects() {
    return [{ source: "/projects/token-price", destination: "/projects/token-lookup", permanent: true }];
  },
};

export default nextConfig;
