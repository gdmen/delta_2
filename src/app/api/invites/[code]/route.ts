import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { inviteCodes } from "@/db/schema";
import { requireUserOr401 } from "@/lib/auth/require";

/**
 * DELETE /api/invites/[code] — owner-only.
 *
 * Revokes an UNUSED invite code by deleting the row outright. Used
 * codes can't be revoked (they've already been claimed; the user
 * exists). The endpoint refuses on used codes with a friendly 409.
 *
 * Owner can only revoke codes they created (where condition includes
 * createdByUserId = user.id) — defense in depth even though this
 * route is owner-only and only one owner exists today.
 */
interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  if (!user.isOwner) {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  const { code } = await ctx.params;
  if (!code) {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  // Refuse to delete a claimed code (the resulting user row would
  // dangle without a corresponding invite-trail entry; cleaner to
  // surface the situation to the operator).
  const found = await db
    .select({ usedAt: inviteCodes.usedAt })
    .from(inviteCodes)
    .where(
      and(
        eq(inviteCodes.code, code),
        eq(inviteCodes.createdByUserId, user.id),
      ),
    )
    .limit(1);
  if (found.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (found[0].usedAt) {
    return NextResponse.json(
      { error: "cannot revoke an already-claimed code" },
      { status: 409 },
    );
  }

  const result = await db
    .delete(inviteCodes)
    .where(
      and(
        eq(inviteCodes.code, code),
        eq(inviteCodes.createdByUserId, user.id),
        isNull(inviteCodes.usedAt),
      ),
    )
    .returning({ code: inviteCodes.code });

  return NextResponse.json({ ok: true, deleted: result.length });
}
