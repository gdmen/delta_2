import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Site-wide auth gate (multi-user, post-PR-2). The proxy only checks
 * for the EXISTENCE of the Auth.js session cookie — actual validation
 * (signature, denylist, password-hash-version) happens inside the
 * route handler via requireUser(). Per the eng-review HIGH finding,
 * keeping the heavy check at the route layer (not middleware) lets
 * the millisecond-scale race between sign-out and an in-flight
 * request resolve cleanly.
 *
 * Cookie name varies by transport (Auth.js convention):
 *   - HTTPS  →  __Secure-authjs.session-token
 *   - HTTP   →  authjs.session-token
 *
 * Exempt paths (matched against the NORMALIZED pathname per the
 * eng-review LOW finding on path traversal — never against
 * request.url):
 *   - /signin, /signup        - users must reach these to authenticate
 *   - /api/auth/*             - Auth.js's own routes (csrf, providers,
 *                               session, signin/credentials, callback/google)
 *   - /api/ingest/*           - bearer-auth or OAuth-state-auth at the
 *                               route level (Strava's servers won't send
 *                               our session cookie)
 *   - /share/*                - read-only public share links by design
 *
 * Unauthenticated requests:
 *   - HTML / page request     - 302 redirect to /signin
 *   - API request             - 401 JSON
 */

const EXEMPT_PREFIXES = [
  "/signin",
  "/signup",
  "/api/auth/",
  "/api/ingest/",
  "/share/",
];

const EXEMPT_EXACT = new Set(["/signin", "/signup"]);

/**
 * Empirical note (verified by src/proxy.test.ts): NextRequest's
 * URL parser fully normalizes `..` and `%2E%2E` BEFORE the proxy
 * sees the path. So `/share/foo/../api/users/me` arrives as
 * `/share/api/users/me` (still under `/share/` — exempt, but harmless
 * because no nested route renders it) and `/share/../api/users/me`
 * arrives as `/api/users/me` (not exempt — auth enforced as expected).
 *
 * The defense-in-depth strip below is belt-and-suspenders for any
 * future Next.js change that surfaces un-normalized segments here.
 */
function isExempt(pathname: string): boolean {
  // Reject anything that smells like un-collapsed path-traversal.
  // Today this is dead code — Next normalizes for us — but keeping
  // it cheap-and-explicit means a future Next regression on this
  // can't silently re-open a bypass.
  if (pathname.includes("..") || pathname.includes("//")) return false;
  if (EXEMPT_EXACT.has(pathname)) return true;
  for (const prefix of EXEMPT_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

function sessionCookieName(protocol: string): string {
  return protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

function isApiRequest(pathname: string, accept: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  // Curl + fetch defaults send `*/*`. Browser navigation sends
  // `text/html,application/xhtml+xml,...`. If the client explicitly
  // accepts JSON before HTML, treat as API.
  return /^application\/json/.test(accept);
}

export function proxy(request: NextRequest) {
  // matcher already excludes _next/* and favicon, so we only see
  // app routes here.
  const pathname = request.nextUrl.pathname;

  // Forward the normalized pathname to server components via a request
  // header. The root layout reads x-pathname (via next/headers) to
  // decide whether to render the sidebar — /share/* and /signin should
  // never get the sidebar even when the visitor has a valid session.
  // Building the headers once here means every NextResponse.next()
  // below uses the same forwarded set.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-pathname", pathname);
  const passthrough = () =>
    NextResponse.next({ request: { headers: forwardedHeaders } });

  // Path-traversal defense: nextUrl.pathname is the normalized form
  // (Next decodes + collapses .. before this runs), so prefix-matching
  // here is safe. NEVER use request.url for the same check — that's
  // the un-normalized form and `/share/foo/../api/users/me` would
  // bypass the auth gate.
  if (isExempt(pathname)) {
    return passthrough();
  }

  // Auth.js session-cookie path.
  const cookieName = sessionCookieName(request.nextUrl.protocol);
  const cookie = request.cookies.get(cookieName);
  if (cookie?.value) {
    return passthrough();
  }

  // No cookie — redirect HTML, JSON-error API.
  const accept = request.headers.get("accept") ?? "";
  if (isApiRequest(pathname, accept)) {
    return NextResponse.json(
      { error: "not signed in" },
      { status: 401 },
    );
  }

  // Capture the original path so /signin can bounce back to it after
  // successful sign-in.
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = `?from=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
