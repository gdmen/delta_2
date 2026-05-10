import { db } from "@/db";
import { sessionDenylist } from "@/db/schema";
import { eq, lt } from "drizzle-orm";

/**
 * JWT revocation list. Sign-out inserts the current request's `jti`;
 * every authed request checks WHERE jti = ? in `requireUser()`.
 *
 * Per the eng-review HIGH finding on denylist semantics:
 *   - The check runs in the route handler (via requireUser), NOT in
 *     middleware. The race window between sign-out and an in-flight
 *     request is millisecond-scale — acceptable.
 *   - Fail CLOSED on DB error: `requireUser()` returns 503 if this
 *     query throws. A Postgres blip MUST NOT become an auth bypass.
 *
 * Sweep semantic: rows older than the JWT TTL (7d) + 1d buffer are
 * unprotective (the token they revoke is itself expired) and can be
 * deleted. Run via scripts/sweep-session-denylist.ts on a daily cron.
 */

const SWEEP_HORIZON_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Returns true if the JWT identified by this jti is denylisted (i.e.
 * sign-out happened on this token). Throws on DB error so the caller
 * (requireUser) can fail closed with 503.
 */
export async function isDenylisted(jti: string): Promise<boolean> {
  const rows = await db
    .select({ jti: sessionDenylist.jti })
    .from(sessionDenylist)
    .where(eq(sessionDenylist.jti, jti))
    .limit(1);
  return rows.length > 0;
}

/**
 * Insert a jti into the denylist. Idempotent — second call for the
 * same jti is a no-op (Postgres ON CONFLICT DO NOTHING).
 *
 * Called by /api/auth/signout after Auth.js's signOut() so the cookie
 * is gone AND any leftover cached cookie from another tab can't be
 * replayed.
 */
export async function denylist(jti: string, userId: number): Promise<void> {
  await db
    .insert(sessionDenylist)
    .values({ jti, userId })
    .onConflictDoNothing();
}

/**
 * Sweep entries older than the JWT TTL window. Runs from a cron;
 * doesn't need to be tied to any request lifecycle.
 *
 * Returns the number of rows deleted (for the cron's log line).
 */
export async function sweep(): Promise<number> {
  const horizon = new Date(Date.now() - SWEEP_HORIZON_MS).toISOString();
  const result = await db
    .delete(sessionDenylist)
    .where(lt(sessionDenylist.revokedAt, horizon))
    .returning({ jti: sessionDenylist.jti });
  return result.length;
}
