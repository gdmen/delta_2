import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, ingestConfigs, coachCalls } from "@/db/schema";
import { createHash } from "node:crypto";
import { requireUserOr401 } from "@/lib/auth/require";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateAndSaveHaeKey } from "@/lib/auth/api-key";
import { generateBearerToken } from "@/lib/auth/secrets";

/**
 * /api/users/me — the signed-in user's own profile.
 *
 *   GET                       → return the user's own row (plus HAE
 *                               key presence).
 *   PATCH (action=password)   → change password. Requires
 *                               currentPassword for credentials users
 *                               (per the eng-review HIGH finding on
 *                               "Set a password" without re-auth).
 *   PATCH (action=hae-key)    → regenerate the HAE bearer token.
 *                               Returns the new plaintext for one-
 *                               time display.
 *   DELETE                    → delete the user's account. Owner
 *                               can't self-delete (would leave Delta
 *                               un-administrable). Cascades clear
 *                               all owned data; coach_calls.user_id
 *                               sets NULL (preserves cost history;
 *                               anonymized by stamping
 *                               deleted_user_hash).
 */

export async function GET() {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  // Check whether the user has a registered HAE key (for the UI's
  // "regenerate" vs "create" button label).
  const hae = await db
    .select({ hasKey: ingestConfigs.lookupHash })
    .from(ingestConfigs)
    .where(eq(ingestConfigs.userId, user.id))
    .limit(1);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isOwner: user.isOwner,
    hasHaeKey: hae.length > 0 && hae[0].hasKey !== null,
  });
}

export async function PATCH(request: Request) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: { action?: unknown; currentPassword?: unknown; newPassword?: unknown };
  try {
    body = (await request.json()) as never;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.action === "password") {
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 8 || newPassword.length > 256) {
      return NextResponse.json(
        { error: "password must be 8-256 characters" },
        { status: 400 },
      );
    }

    // Pull the user's current hash so we can verify the
    // current-password proof. Required even for "Set a password"
    // (Google-only user adding a password) — the eng-review HIGH
    // finding flagged that without re-auth a session-hijack on a
    // Google user instantly grants persistent credentials access.
    // For Google-only users, we currently DON'T have a way to
    // re-verify (no re-auth flow built in PR 2). The compromise:
    // require an empty currentPassword (signaling "I know there
    // isn't one yet") AND insist the JWT was issued recently.
    // We don't have JWT iat exposed to requireUser yet, so
    // for now any signed-in Google-only user can set a password.
    // TODO(pr2-followup): re-auth gate on JWT iat < 5min for
    // Google-only "Set a password" path.
    const found = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const currentHash = found[0]?.passwordHash;

    if (currentHash && currentHash !== "!") {
      // Existing credentials user — must prove current password.
      const ok = await verifyPassword(currentPassword, currentHash);
      if (!ok) {
        return NextResponse.json(
          { error: "current password is incorrect" },
          { status: 400 },
        );
      }
    }
    // else: Google-only or un-bootstrapped owner — no current
    // password to verify (covered by TODO above).

    const newHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({
        passwordHash: newHash,
        // Bump pwv so any other outstanding session for this user
        // is invalidated (defense against password-change-doesn't-
        // log-out-other-devices class).
        passwordHashVersion: sql`${users.passwordHashVersion} + 1`,
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({ ok: true });
  }

  if (body.action === "hae-key") {
    const fresh = generateBearerToken();
    await generateAndSaveHaeKey(user.id, fresh);
    return NextResponse.json({ ok: true, token: fresh });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE() {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  if (user.isOwner) {
    return NextResponse.json(
      { error: "owner cannot self-delete" },
      { status: 403 },
    );
  }

  // Anonymize coach_calls (preserves per-ex-user cost attribution
  // without retaining the email) BEFORE the cascade fires.
  const emailHash = user.email
    ? createHash("sha256").update(user.email, "utf-8").digest("hex")
    : null;
  if (emailHash) {
    await db
      .update(coachCalls)
      .set({ deletedUserHash: emailHash })
      .where(eq(coachCalls.userId, user.id));
  }

  // The DELETE cascades clear every owned row (sports, metric_types,
  // metrics, events, goals, dashboards, etc.). coach_calls.user_id
  // has ON DELETE SET NULL specifically to keep the rows alive.
  await db.delete(users).where(eq(users.id, user.id));

  return NextResponse.json({ ok: true });
}
