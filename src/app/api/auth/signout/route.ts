import { NextResponse } from "next/server";
import { signOut, auth } from "@/lib/auth/config";
import { denylist } from "@/lib/auth/denylist";

/**
 * POST /api/auth/signout
 *
 * Wraps Auth.js's signOut() so we ALSO insert the current request's
 * JWT jti into session_denylist before clearing the cookie. Without
 * the denylist insert, a copy of the cookie cached in another tab
 * (or extracted before sign-out) would still be honored by
 * `requireUser()` until JWT TTL expires.
 *
 * Belt-and-suspenders: Auth.js's default GET signout path at
 * /api/auth/signout (re-exported via the [...nextauth] handler)
 * would bypass this route. The `events.signOut` hook in config.ts
 * catches that case by denylisting on every Auth.js signOut,
 * regardless of HTTP method, so the kill-switch holds even when
 * the user is sent through Auth.js's own form.
 */

export async function POST() {
  const session = await auth();

  if (session) {
    const jti = typeof session.jti === "string" ? session.jti : "";
    const userId = parseInt(session.user?.id ?? "", 10);
    if (jti && Number.isFinite(userId)) {
      // Don't let a denylist write failure block the signOut.
      // events.signOut in config.ts also denylists, so either
      // path lands the row.
      try {
        await denylist(jti, userId);
      } catch (err) {
        console.error("[signout] denylist insert failed:", err);
      }
    }
    await signOut({ redirect: false });
  }

  return NextResponse.json({ ok: true });
}
