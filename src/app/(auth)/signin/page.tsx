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
 */
function safeRedirect(from?: string): string {
  if (!from) return "/";
  if (!from.startsWith("/") || from.startsWith("//")) return "/";
  return from;
}
