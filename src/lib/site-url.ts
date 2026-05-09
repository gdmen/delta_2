/**
 * Public origin where Delta is served from. Used by the data-source
 * setup pages to render copy-pasteable iOS Shortcut URLs (Apple Health)
 * and Strava callback domains.
 *
 * Reads `NEXT_PUBLIC_SITE_ORIGIN` so both server and client components
 * see the same value (Next.js inlines NEXT_PUBLIC_* into the client
 * bundle at build time). Defaults to `http://localhost:3001` for the
 * dev server — match the port we run dev on.
 *
 * Configure in `.env.local`:
 *
 *   NEXT_PUBLIC_SITE_ORIGIN=https://delta.example.com
 */
export function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3001";
}

/**
 * Bare hostname (no scheme, no path) — what Strava's app-registration
 * page asks for as the "Authorization Callback Domain."
 */
export function siteHost(): string {
  try {
    return new URL(siteOrigin()).host;
  } catch {
    return siteOrigin();
  }
}

/**
 * Full ingest URL for a given source. Use for HAE setup, future Strava
 * webhook setup, etc.
 */
export function ingestUrl(source: string): string {
  return `${siteOrigin()}/api/ingest/${source}`;
}
