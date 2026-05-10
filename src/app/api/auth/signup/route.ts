import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, inviteCodes } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

/**
 * POST /api/auth/signup
 *
 * Body: { code, email, password, displayName }
 *
 * Custom sign-up route for the credentials provider — Auth.js
 * doesn't ship one (it's not part of the OAuth-flavored spec).
 *
 * Atomicity model (post adversarial-review MEDIUM-1 fix):
 *   - Hash the password BEFORE the transaction (argon2 is slow and
 *     allocates 19 MiB; doing it inside the tx would hold a row
 *     lock for ~150ms).
 *   - Run claim + user-insert + invite-backfill in a single Postgres
 *     transaction. If anything fails (email collision, FK error,
 *     etc.) the tx rolls back and the invite returns to unused
 *     atomically — no window where another tab sees the code as
 *     "spent" for a partial signup that didn't actually succeed.
 *
 * Returns the new user's id + email on success. The client then
 * follows up with /api/auth/signin/credentials to issue the JWT
 * cookie — keeps the sign-in cookie path strictly within Auth.js's
 * machinery.
 */

interface SignupBody {
  code?: unknown;
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
}

export async function POST(request: NextRequest) {
  let body: SignupBody;
  try {
    body = (await request.json()) as SignupBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

  if (!code) {
    return NextResponse.json({ error: "invite code required" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  if (password.length < 8 || password.length > 256) {
    return NextResponse.json(
      { error: "password must be 8-256 characters" },
      { status: 400 },
    );
  }
  if (!displayName) {
    return NextResponse.json({ error: "display name required" }, { status: 400 });
  }

  // Hash OUTSIDE the tx — argon2id at OWASP-2024 params takes ~150ms
  // and allocates 19 MiB. Holding a tx for that long would block
  // concurrent invite-code claims for no good reason.
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    return NextResponse.json(
      { error: `password hashing failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Single tx: atomic claim, user insert, invite backfill. If any
  // step throws, Postgres rolls the whole thing back — the invite
  // returns to "unused," no half-created user, no rolled-back state
  // for another tab to race against.
  type SignupOk = { ok: true; userId: number; email: string | null };
  type SignupErr = { ok: false; status: number; error: string };

  let result: SignupOk | SignupErr;
  try {
    result = await db.transaction(async (tx) => {
      const claim = await tx
        .update(inviteCodes)
        .set({ usedAt: new Date().toISOString() })
        .where(
          sql`${inviteCodes.code} = ${code} AND ${inviteCodes.usedAt} IS NULL AND (${inviteCodes.expiresAt} IS NULL OR ${inviteCodes.expiresAt} > ${new Date().toISOString()})`,
        )
        .returning({ code: inviteCodes.code });
      if (claim.length === 0) {
        return {
          ok: false as const,
          status: 400,
          error: "invite code is invalid, expired, or already used",
        };
      }

      // Friendly pre-check for email collision; the unique index on
      // users.email backstops it if a concurrent request races us.
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing.length > 0) {
        // Throw so the tx rolls back — releases the invite claim.
        throw new Error("__EMAIL_TAKEN__");
      }

      const inserted = await tx
        .insert(users)
        .values({
          email,
          displayName,
          passwordHash,
          createdAt: new Date().toISOString(),
        })
        .returning({ id: users.id, email: users.email });
      const newUser = inserted[0];

      await tx
        .update(inviteCodes)
        .set({ usedByUserId: newUser.id })
        .where(eq(inviteCodes.code, code));

      return { ok: true as const, userId: newUser.id, email: newUser.email };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "__EMAIL_TAKEN__") {
      return NextResponse.json({ error: "email already in use" }, { status: 400 });
    }
    // Unique-constraint race or other Postgres error. The tx already
    // rolled back, so the invite is still unused.
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "email already in use" }, { status: 400 });
    }
    return NextResponse.json(
      { error: `signup failed: ${msg}` },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    user: { id: result.userId, email: result.email },
  });
}
