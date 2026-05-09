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
 * TODO(pr2-phase-5): we don't currently have access to the raw jti
 * here — Auth.js's `auth()` returns the decoded session, not the
 * underlying token. Surface jti on the session callback in
 * config.ts so this route can read it. For now we just call
 * Auth.js's signOut which clears the cookie; the denylist insert
 * is a stub that will be wired once jti is exposed.
 */

export async function POST() {
  const session = await auth();
  // TODO: read jti from the JWT (currently not surfaced on session).
  // When wired:
  //   const jti = session?.jti as string | undefined;
  //   const userId = parseInt(session?.user?.id ?? "", 10);
  //   if (jti && Number.isFinite(userId)) await denylist(jti, userId);
  void denylist; // keep import live until wired

  // Auth.js's signOut clears the cookie. With redirect: false it
  // returns void, so we hand the client a clean 200 + null body and
  // let the client navigate.
  if (session) {
    await signOut({ redirect: false });
  }

  return NextResponse.json({ ok: true });
}
