import { describe, expect, it, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function makeRequest(
  path = "/",
  opts: { headers?: Record<string, string>; cookies?: Record<string, string>; protocol?: "http" | "https" } = {},
): NextRequest {
  const proto = opts.protocol ?? "http";
  const headers = new Headers(opts.headers ?? {});
  if (opts.cookies) {
    const cookieStr = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    headers.set("cookie", cookieStr);
  }
  return new NextRequest(`${proto}://localhost${path}`, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Multi-user proxy gate (post-PR-2). Two modes:
 *
 *   1. Auth.js session cookie  → check existence (no validation —
 *                                 requireUser does the heavy lifting).
 *   2. Exempt path             → always pass through.
 *
 * Per the eng-review LOW finding: exemption matching uses the
 * NORMALIZED nextUrl.pathname so `/share/foo/../api/users/me` doesn't
 * bypass the gate. NextRequest already normalizes by the time we see
 * the path.
 */
describe("proxy auth gate", () => {
  describe("exempt paths (no auth required)", () => {
    it.each([
      "/signin",
      "/signup",
      "/api/auth/session",
      "/api/auth/csrf",
      "/api/auth/callback/google",
      "/api/ingest/apple-health",
      "/api/ingest/strava/sync",
      "/share/abc123",
    ])("%s passes through with no cookie", (path) => {
      const res = proxy(makeRequest(path));
      expect(res.status).toBe(200);
    });
  });

  describe("session-cookie path (Auth.js)", () => {
    it("HTTP request with `authjs.session-token` cookie → next", () => {
      const res = proxy(
        makeRequest("/dashboards/today", {
          cookies: { "authjs.session-token": "any-value-the-route-validates-it" },
        }),
      );
      expect(res.status).toBe(200);
    });

    it("HTTPS request with `__Secure-authjs.session-token` cookie → next", () => {
      const res = proxy(
        makeRequest("/dashboards/today", {
          protocol: "https",
          cookies: { "__Secure-authjs.session-token": "any-value" },
        }),
      );
      expect(res.status).toBe(200);
    });

    it("HTTP request with the HTTPS cookie name → not authenticated (cookie name resolution is protocol-dependent)", () => {
      const res = proxy(
        makeRequest("/dashboards/today", {
          protocol: "http",
          // wrong-named cookie for HTTP transport
          cookies: { "__Secure-authjs.session-token": "any-value" },
        }),
      );
      expect(res.status).toBe(307); // redirect to /signin
    });

    it("HTML request with no cookie → 307 redirect to /signin?from=…", () => {
      const res = proxy(
        makeRequest("/dashboards/today", {
          headers: { accept: "text/html,application/xhtml+xml" },
        }),
      );
      expect(res.status).toBe(307);
      expect(res.headers.get("location") ?? "").toContain("/signin");
      expect(res.headers.get("location") ?? "").toContain("from=");
      expect(res.headers.get("location") ?? "").toContain(
        encodeURIComponent("/dashboards/today"),
      );
    });

    it("API request (path under /api/) with no cookie → 401 JSON", async () => {
      const res = proxy(makeRequest("/api/dashboards"));
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not signed in/);
    });

    it("client that explicitly accepts JSON → 401 JSON", async () => {
      const res = proxy(
        makeRequest("/dashboards/today", {
          headers: { accept: "application/json" },
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("path-traversal defense (eng-review LOW)", () => {
    // Empirically: WHATWG URL parsing inside NextRequest collapses
    // `/share/foo/../api/users/me` to `/share/api/users/me` BEFORE the
    // proxy ever sees it. So the prefix-match against `/share/` does
    // exempt this collapsed path. That's safe because there's no route
    // at `/share/[anything-other-than-the-token-page]/...` — the
    // collapsed request 404s downstream. The defense-in-depth here is
    // that the share-page route itself only ever exposes a single
    // dashboard's read-only data, never anything API-shaped.
    //
    // If a future refactor adds a catch-all route under `/share/`,
    // re-evaluate this exemption.
    it("collapsed paths under /share/ exempt (safe — no nested route)", () => {
      const res = proxy(makeRequest("/share/foo/../api/users/me"));
      // After normalization the path is `/share/api/users/me`, prefix
      // matches `/share/`, exempt → 200 from the proxy. The route layer
      // 404s because no page renders that path.
      expect(res.status).toBe(200);
    });

    it("traversal attempts that escape /share/ exempt scope are caught (no /api/ route reachable)", () => {
      // The strongest possible attack: try to escape /share/ entirely
      // by traversing past it. URL normalization collapses
      // `/share/../api/users/me` to `/api/users/me` — which is NOT
      // under any exempt prefix. The proxy then enforces auth on it.
      const res = proxy(makeRequest("/share/../api/users/me"));
      // After normalization the path is `/api/users/me`, no exempt
      // match, no cookie present → 401.
      expect(res.status).toBe(401);
    });

    // Adversarial review MEDIUM-6: pin the encoded-sequence behavior
    // against a Next regression. WHATWG URL parsing should decode +
    // collapse these BEFORE the proxy sees them; if a future Next
    // upgrade changes that, this test screams.
    it("percent-encoded traversal: /share/foo/%2E%2E/api/users/me", () => {
      const res = proxy(makeRequest("/share/foo/%2E%2E/api/users/me"));
      // Decoded + collapsed → `/share/api/users/me` (no nested route,
      // 404s downstream, but the proxy correctly considers it exempt).
      // Exit code 200 means the proxy passed it through; whatever
      // happens downstream is the route layer's job.
      expect(res.status).toBe(200);
    });

    it("double-encoded traversal: /share/foo/%252E%252E/api/users/me", () => {
      // %25 is "%", so %252E is "%2E" as a literal. After ONE level
      // of decoding the path contains literal `%2E%2E`, which is
      // NOT a traversal sequence to the WHATWG URL parser. Treated
      // as a normal path segment — exempt under /share/, no further
      // collapse.
      const res = proxy(makeRequest("/share/foo/%252E%252E/api/users/me"));
      expect(res.status).toBe(200);
    });

    it("traversal that escapes /share/: /share/%2E%2E/api/users/me", () => {
      // Single-encoded, decodes to `/share/../api/users/me` then
      // collapses to `/api/users/me`. Should NOT be exempt.
      const res = proxy(makeRequest("/share/%2E%2E/api/users/me"));
      expect(res.status).toBe(401);
    });

    it("traversal with backslash variant: /share\\..\\api/users/me", () => {
      // Backslash is NOT a path separator in URL pathname under
      // WHATWG; it's just another character. Should stay as
      // `/share\\..\\api/users/me`, prefix-match `/share/`? No —
      // because the prefix is `/share/` (with slash), this path
      // doesn't match. Falls through to the auth gate → 401.
      const res = proxy(makeRequest("/share\\..\\api/users/me"));
      expect(res.status).toBe(401);
    });
  });
});
