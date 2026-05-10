import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { SignInForm } from "./form";

/**
 * /signin — credentials + Google. If the user is already signed in,
 * bounce to / (or to the `?from=` redirect target if the proxy sent
 * them here from a protected page).
 *
 * Per the design plan: form-as-hero, single 360px card, "Continue
 * with Google" on top, "or" divider, email + password below. Same
 * generic error copy on either failure (no user-enumeration leak).
 */
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  const session = await auth();
  if (session?.user?.id) {
    redirect(safeRedirect(from));
  }
  return <SignInForm callbackUrl={safeRedirect(from)} error={error} />;
}

/**
 * Same-origin only: `from=` from the proxy is always a Delta path,
 * but we still belt-and-suspenders so an attacker can't craft a
 * `?from=https://evil.example.com/phish` link that bounces a freshly-
 * signed-in user off-site.
 *
 * The naive `startsWith("/") && !startsWith("//")` check (what we
 * shipped first) has a real bypass: WHATWG URL parsing in Chrome and
 * Safari normalizes backslashes to forward slashes, so `/\evil.com`
 * passes the check then becomes `//evil.com` (protocol-relative
 * external redirect) at navigation time. Parse the URL against a
 * sentinel origin instead and assert the result's origin matches —
 * any path that normalizes off-site fails this check.
 */
function safeRedirect(from?: string): string {
  if (!from) return "/";
  try {
    const SENTINEL = "http://delta.internal";
    const u = new URL(from, SENTINEL);
    if (u.origin !== SENTINEL) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
