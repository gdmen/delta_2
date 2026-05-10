import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "./config";
import { isDenylisted } from "./denylist";
import { getShareContext } from "@/lib/share/scope";

/**
 * Per-request auth gate. Loads the JWT from the cookie via Auth.js,
 * validates that the jti hasn't been revoked, validates that the
 * passwordHashVersion still matches (kill-all-sessions bumps this),
 * and returns the loaded user row.
 *
 * Per the eng-review HIGH findings:
 *
 *   1. Both DB checks (pwv + denylist) run inside this function (i.e.
 *      in the route handler), NOT in middleware. The race window
 *      between sign-out and an in-flight request is millisecond-scale.
 *   2. Combined into a single SELECT — pulls (id, display_name,
 *      is_owner, password_hash_version) in one query so we get the
 *      authoritative isOwner flag too (JWT payload is locked to the
 *      minimum, no isOwner). Cost: 2 indexed selects per authed
 *      request (this one + denylist), not three.
 *   3. Fail CLOSED on Postgres error — `requireUser()` returns 503
 *      via UnauthorizedError if either query throws. A DB blip MUST
 *      NOT become an auth bypass.
 *
 * Returns the loaded user. Throws `UnauthorizedError` for callers
 * that prefer the throw-and-convert pattern; thin wrappers in this
 * file (requireUserOr401, requireUserOrSignin) convert the throw to
 * the appropriate HTTP shape.
 */

export interface RequiredUser {
  id: number;
  displayName: string;
  isOwner: boolean;
  jti: string;
  email: string | null;
}

export class UnauthorizedError extends Error {
  status: number;
  constructor(reason: string, status = 401) {
    super(reason);
    this.name = "UnauthorizedError";
    this.status = status;
  }
}

export async function requireUser(): Promise<RequiredUser> {
  // Defense: a server component running INSIDE a /share/<token>
  // render scope must never call requireUser() — that path is for
  // the OWNER's data, not the viewer's. If a widget renderer was
  // written in the "establish session and query my own data"
  // pattern (the established shape everywhere else in the
  // codebase), running it during share render would silently
  // substitute the VIEWER's user id for the owner's. Fail loud
  // instead. The DashboardRenderer.shareMode prop path is the
  // legitimate one — it threads ownerId as an arg, never asks
  // requireUser().
  if (getShareContext()) {
    throw new UnauthorizedError(
      "requireUser() called inside runInShareScope — code path must accept userId as an explicit arg",
      500,
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError("not signed in");
  }
  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) {
    throw new UnauthorizedError("malformed session");
  }

  // Single SELECT: id, displayName, isOwner, email, pwv. The pwv
  // column is compared to the session's pwv (stamped at JWT issue
  // time); a mismatch means the password was changed (or admin-
  // reset-password was run) since this JWT was issued, so every
  // outstanding token for this user is invalidated.
  let row:
    | { id: number; displayName: string; isOwner: boolean; email: string | null; pwv: number }
    | undefined;
  try {
    const found = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        isOwner: users.isOwner,
        email: users.email,
        pwv: users.passwordHashVersion,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    row = found[0];
  } catch (err) {
    // Fail CLOSED on DB blip — a Postgres outage MUST NOT auth-bypass.
    throw new UnauthorizedError(
      `db error: ${err instanceof Error ? err.message : String(err)}`,
      503,
    );
  }

  if (!row) {
    // User was deleted between issuance and now.
    throw new UnauthorizedError("user no longer exists");
  }

  // Password-hash-version invariant — the kill-all-sessions
  // primitive. A password change or admin-reset bumps pwv on the
  // users row; every JWT carrying the OLD pwv must be rejected.
  // Old JWTs that pre-date the pwv-on-session wiring would have
  // session.pwv === undefined; in that case we accept (treat as
  // "issued before the kill-switch existed") rather than
  // mass-evict every existing session on rollout.
  if (typeof session.pwv === "number" && session.pwv !== row.pwv) {
    throw new UnauthorizedError("session revoked (password changed)");
  }

  // Denylist check — for "sign out this device" / "log out
  // everywhere." Insert into session_denylist on sign-out (see
  // /api/auth/signout and the Auth.js signOut event in config.ts).
  // Fail closed on Postgres error so a denylist outage doesn't
  // become an auth bypass.
  const jti = typeof session.jti === "string" ? session.jti : "";
  if (jti && (await isDenylistedSafely(jti))) {
    throw new UnauthorizedError("session revoked");
  }

  return {
    id: row.id,
    displayName: row.displayName,
    isOwner: row.isOwner,
    email: row.email,
    jti,
  };
}

async function isDenylistedSafely(jti: string): Promise<boolean> {
  try {
    return await isDenylisted(jti);
  } catch (err) {
    throw new UnauthorizedError(
      `denylist db error: ${err instanceof Error ? err.message : String(err)}`,
      503,
    );
  }
}

/**
 * Convenience for API route handlers: returns the user or a
 * NextResponse with the appropriate error code.
 */
export async function requireUserOr401(): Promise<
  { user: RequiredUser; error: null } | { user: null; error: NextResponse }
> {
  try {
    const user = await requireUser();
    return { user, error: null };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return {
        user: null,
        error: NextResponse.json({ error: err.message }, { status: err.status }),
      };
    }
    throw err;
  }
}

/**
 * Convenience for server components: returns the user or redirects
 * to /signin.
 */
export async function requireUserOrSignin(): Promise<RequiredUser> {
  try {
    return await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError && err.status === 401) {
      redirect("/signin");
    }
    throw err;
  }
}
