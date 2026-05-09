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
 * doesn't ship one (it's not part of the OAuth-flavored spec). Steps:
 *
 *   1. Validate body shape (email format, password length 8-256,
 *      displayName non-empty).
 *   2. Atomic-claim the invite code via UPDATE...WHERE used_by_user_id
 *      IS NULL + rowCount === 1. The "atomic-claim before user
 *      creation" ordering matters for double-submit safety: if two
 *      tabs claim the same code at once, exactly one wins and the
 *      other gets a "code already used" error WITHOUT a phantom
 *      half-created user row.
 *   3. Check email isn't already taken (race-loseable but the unique
 *      constraint catches it; we check for the friendly error first).
 *   4. Hash password (argon2id, OWASP 2024 params).
 *   5. INSERT users row.
 *   6. Backfill the invite_codes.used_by_user_id with the new user's
 *      id. (Step 2 set used_at; this fills the FK once we have the id.)
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

  // ---------------------------------------------------------------
  // Step 2: atomic claim of the invite code. The UPDATE returns 0 rows
  // if the code is already used (or doesn't exist, or expired) — we
  // check rowCount instead of doing a SELECT-then-UPDATE which is a
  // TOCTOU race.
  //
  // Note we set used_at NOW but leave used_by_user_id NULL until we
  // have the new user's id (filled in step 6). The non-null used_at
  // is what locks the code; the FK fill is bookkeeping.
  // ---------------------------------------------------------------
  const claim = await db
    .update(inviteCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(
      sql`${inviteCodes.code} = ${code} AND ${inviteCodes.usedAt} IS NULL AND (${inviteCodes.expiresAt} IS NULL OR ${inviteCodes.expiresAt} > ${new Date().toISOString()})`,
    )
    .returning({ code: inviteCodes.code });

  if (claim.length === 0) {
    return NextResponse.json(
      { error: "invite code is invalid, expired, or already used" },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------
  // Step 3: friendly check on email collision (the unique constraint
  // on users.email backstops this).
  // ---------------------------------------------------------------
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    // Roll back the invite claim — they can try again with a different
    // email, or the actual user can sign in.
    await db
      .update(inviteCodes)
      .set({ usedAt: null })
      .where(eq(inviteCodes.code, code));
    return NextResponse.json(
      { error: "email already in use" },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------
  // Step 4-5: hash password + create user.
  // ---------------------------------------------------------------
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    // Roll back the invite claim.
    await db
      .update(inviteCodes)
      .set({ usedAt: null })
      .where(eq(inviteCodes.code, code));
    return NextResponse.json(
      { error: `password hashing failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  let inserted: { id: number; email: string | null }[];
  try {
    inserted = await db
      .insert(users)
      .values({ email, displayName, passwordHash, createdAt: new Date().toISOString() })
      .returning({ id: users.id, email: users.email });
  } catch (err) {
    // Most likely a unique constraint violation on email (race we
    // checked but lost). Roll back the invite claim and report.
    await db
      .update(inviteCodes)
      .set({ usedAt: null })
      .where(eq(inviteCodes.code, code));
    return NextResponse.json(
      { error: `user creation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const newUser = inserted[0];

  // ---------------------------------------------------------------
  // Step 6: backfill the invite-code FK with the new user's id.
  // ---------------------------------------------------------------
  await db
    .update(inviteCodes)
    .set({ usedByUserId: newUser.id })
    .where(eq(inviteCodes.code, code));

  return NextResponse.json({
    ok: true,
    user: { id: newUser.id, email: newUser.email },
  });
}
