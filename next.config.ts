import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // We run a proxy.ts (for the site-wide basic auth gate), which makes
    // Next.js buffer every request body with a 10 MB default cap. Health
    // Auto Export's first-run backfill can easily exceed that — raise it.
    proxyClientMaxBodySize: "200mb",
  },
  typescript: {
    // Next 16 runs the TS check in worker_threads with a hardcoded heap
    // limit that OOMs on small deploy instances (~466MB cap regardless of
    // NODE_OPTIONS). deploy.sh runs `tsc --noEmit` as a separate step
    // before this build, so type errors still gate the deploy — this just
    // skips the redundant in-build pass.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
