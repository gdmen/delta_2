import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inviteCodes, users } from "@/db/schema";
import { requireUserOr401 } from "@/lib/auth/require";

/**
 * /api/invites — owner-only.
 *
 *   POST  → mint a new invite code. Body: { ttlDays?: number }.
 *           Defaults to no expiry (null).
 *   GET   → list all invite codes the owner has created (oldest
 *           first), with claimed-by info.
 *
 * Per-code DELETE lives at /api/invites/[code]/route.ts.
 */

function newInviteCode(): string {
  // 9 bytes base32-ish via base64url, sliced — gives a short readable
  // string that's still ~54 bits of entropy. Format: 3 groups of 4
  // chars separated by dashes for human-friendliness.
  //
  //   AAAA-BBBB-CCCC
  const raw = randomBytes(9).toString("base64url").replace(/[_-]/g, "0");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`.toUpperCase();
}

export async function POST(request: Request) {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  if (!user.isOwner) {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  let body: { ttlDays?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    // ignore — defaults are fine
  }

  let expiresAt: string | null = null;
  if (typeof body.ttlDays === "number" && body.ttlDays > 0) {
    expiresAt = new Date(
      Date.now() + body.ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  // Retry on the rare collision (54 bits of entropy + 4-char human
  // dashes; collisions improbable but the loop catches it).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newInviteCode();
    try {
      await db.insert(inviteCodes).values({
        code,
        createdByUserId: user.id,
        expiresAt,
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ code, expiresAt });
    } catch {
      // Probably a unique-constraint collision on `code`. Retry.
      continue;
    }
  }
  return NextResponse.json(
    { error: "failed to mint a unique invite code after retries" },
    { status: 500 },
  );
}

export async function GET() {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  if (!user.isOwner) {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  // Owner sees every invite they created plus claim status. JOIN
  // users so the UI can show "claimed by Alice" without a separate
  // round-trip.
  const rows = await db
    .select({
      code: inviteCodes.code,
      createdAt: inviteCodes.createdAt,
      expiresAt: inviteCodes.expiresAt,
      usedAt: inviteCodes.usedAt,
      usedByUserId: inviteCodes.usedByUserId,
      usedByDisplayName: users.displayName,
    })
    .from(inviteCodes)
    .leftJoin(users, eq(users.id, inviteCodes.usedByUserId))
    .where(eq(inviteCodes.createdByUserId, user.id))
    .orderBy(desc(inviteCodes.createdAt));

  return NextResponse.json({ invites: rows });
}
