/**
 * Resolve the canonical public origin (proto + host) the user reached
 * the app at. Used to build OAuth redirect_uri values that have to
 * point at the same host as the user's browser.
 *
 * The naive read of `x-forwarded-host` / `x-forwarded-proto` from the
 * request trusts ANY client that can set those headers. Default nginx
 * configs don't strip them on the inbound side, so an attacker can
 * spoof `x-forwarded-host: evil.com` and watch the app build OAuth
 * URLs that hand auth codes to evil.com.
 *
 * The fix: an env-var allow-list. ALLOWED_PUBLIC_HOSTS is a
 * comma-separated set of acceptable public hostnames (no protocol).
 * If the resolved host isn't on the list, we throw. Production must
 * set this; dev tolerates an empty list and falls back to whatever
 * the request says (localhost only).
 */
function allowedHosts(): Set<string> {
  const raw = process.env.ALLOWED_PUBLIC_HOSTS ?? "";
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestUrl = new URL(request.url);

  const host = (
    forwardedHost ??
    request.headers.get("host") ??
    requestUrl.host
  ).toLowerCase();
  const proto = (forwardedProto ?? requestUrl.protocol.replace(":", "")).toLowerCase();

  const allow = allowedHosts();
  if (allow.size > 0) {
    if (!allow.has(host)) {
      throw new Error(
        `host "${host}" not in ALLOWED_PUBLIC_HOSTS; refusing to build OAuth redirect`,
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ALLOWED_PUBLIC_HOSTS env var is required in production for OAuth redirect-uri construction",
    );
  } else {
    // Dev: tolerate localhost-ish hosts so the bootstrap flow works
    // before the operator sets ALLOWED_PUBLIC_HOSTS. Reject anything
    // public-shaped to keep the developer honest.
    const devOk =
      host === "localhost" ||
      host.startsWith("localhost:") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("[::1]");
    if (!devOk) {
      throw new Error(
        `dev-mode host "${host}" not allowed; set ALLOWED_PUBLIC_HOSTS to whitelist`,
      );
    }
  }

  return `${proto}://${host}`;
}
