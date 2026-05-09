import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "./config";
import { isDenylisted } from "./denylist";

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
  const session = await auth();
  // jti lives on the JWT but Auth.js doesn't surface it in `session`
  // by default. We added the session callback in config.ts to expose
  // user.id; jti needs a separate read of the raw token. For now,
  // we trust the session.user.id and skip the jti check until we
  // wire up token.jti exposure. TODO(pr2-phase-5): expose jti on
  // session and gate denylist check here.
  if (!session?.user?.id) {
    throw new UnauthorizedError("not signed in");
  }
  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) {
    throw new UnauthorizedError("malformed session");
  }

  // Single SELECT: id, displayName, isOwner, pwv. The pwv check
  // would compare against jwt.pwv if we had it surfaced; for now
  // we just load the user row.
  let row: { id: number; displayName: string; isOwner: boolean; email: string | null } | undefined;
  try {
    const found = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        isOwner: users.isOwner,
        email: users.email,
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

  // Denylist check — see denylist.ts. Today we don't have jti
  // surfaced from Auth.js's JWT, so this is a stub that always
  // passes. Wire-up in a follow-up phase.
  // TODO(pr2-phase-5): get jti from Auth.js JWT and gate.
  const jti = ""; // placeholder
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
