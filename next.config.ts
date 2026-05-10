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
  async headers() {
    // CSP on /share/* per the eng-review HIGH finding on owner-XSS into
    // share-link viewers via dashboard/widget titles. Same-origin only;
    // no framing off-site (clickjacking defense). Anywhere the renderer
    // uses dangerouslySetInnerHTML on owner-controlled strings is a
    // hole — phase 9's isolation harness audits for that.
    //
    // script-src 'unsafe-inline' is required because React's RSC
    // streaming uses inline <script> tags to push the payload
    // (`self.__next_f.push([...])`) and swap the suspense placeholders
    // (`$RS = function(...)`). Without it the page hangs in skeleton
    // state forever. Tradeoff documented; the upgrade path is
    // nonce-based CSP (per-request nonce on every script tag — not a
    // Next 16 default, doable as follow-up).
    //
    // 'unsafe-eval' is dev-only — React's dev-mode error-overlay uses
    // eval() to reconstruct stack frames across server/client boundary.
    // Production React never calls eval, so prod CSP stays strict.
    const scriptSrc =
      process.env.NODE_ENV === "production"
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

    return [
      {
        source: "/share/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "frame-ancestors 'self'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No referer-leak when a viewer clicks a link out of the
          // shared dashboard.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
