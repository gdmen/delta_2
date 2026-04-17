import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Very simple site-wide HTTP Basic Auth gate.
 *
 * Reads SITE_PASSWORD from .env.local. If unset, the site is wide open (useful
 * for local dev). If set, every request outside the exempt list must include
 * an Authorization: Basic header with the matching password (username is
 * ignored - any value works, "delta" is a fine default).
 *
 * Exempt paths:
 *   - /api/ingest/*   - has its own auth (bearer token for apple-health,
 *                       OAuth state+code for Strava callback). Strava's
 *                       servers won't send Basic creds.
 *   - Next.js internals (_next/*) are already excluded via the matcher.
 */
export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;

  // No password configured → gate disabled.
  if (!password) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Ingest endpoints authenticate themselves; don't gate them.
  if (pathname.startsWith("/api/ingest/")) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const supplied = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    if (supplied === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Delta", charset="UTF-8"',
    },
  });
}

export const config = {
  // Run on every route except Next.js static assets / image optimizer / favicon.
  // /api/ingest/* is allowed through inside the proxy function above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
