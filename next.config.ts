import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // We run a proxy.ts (for the site-wide basic auth gate), which makes
    // Next.js buffer every request body with a 10 MB default cap. Health
    // Auto Export's first-run backfill can easily exceed that — raise it.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
