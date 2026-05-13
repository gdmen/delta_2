import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, eventDuplicateDenylist } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * POST /api/events/[id]/unmerge
 *
 * Tear-down for a composite event. Three things happen:
 *
 *  1. Flip every member event back to `status='visible'` (they were
 *     `hidden_by_composite` while the composite existed).
 *  2. Insert an `event_duplicate_denylist` row for every member pair.
 *     The unmerge action signals "these aren't the same session" —
 *     re-running the detector should not flag them again.
 *  3. Delete the composite row itself.
 *
 * After this, the member events are visible in normal queries again
 * and can be re-merged into a different composite via /api/events/merge
 * if the user changes their mind (denylist entries can be removed —
 * future PR if needed).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: events.id,
      status: events.status,
      memberIds: events.compositeMemberIds,
    })
    .from(events)
    .where(and(userScope(user.id).events, eq(events.id, id)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const composite = rows[0];
  if (composite.status !== "composite") {
    return NextResponse.json(
      { error: `Event ${id} is not a composite (status='${composite.status}')` },
      { status: 409 },
    );
  }
  if (composite.memberIds.length < 2) {
    // Degenerate: composite with <2 members shouldn't normally exist,
    // but handle gracefully — just delete it and bail.
    await db
      .delete(events)
      .where(and(userScope(user.id).events, eq(events.id, id)));
    return NextResponse.json({ ok: true, denylistInserts: 0 });
  }

  // Build the denylist insert payload: every unordered pair from the
  // member list. For 2 members that's one row; for N members it's
  // C(N, 2) rows.
  const sorted = [...composite.memberIds].sort((a, b) => a - b);
  const denylistRows: { userId: number; eventAId: number; eventBId: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      denylistRows.push({
        userId: user.id,
        eventAId: sorted[i],
        eventBId: sorted[j],
      });
    }
  }

  // ON CONFLICT DO NOTHING — a pair could already be denylisted from a
  // previous unmerge cycle (merge → unmerge → re-merge → unmerge).
  await db
    .insert(eventDuplicateDenylist)
    .values(denylistRows)
    .onConflictDoNothing();

  // Flip members back to visible.
  await db
    .update(events)
    .set({ status: "visible" })
    .where(and(userScope(user.id).events, inArray(events.id, sorted)));

  // Drop the composite.
  await db
    .delete(events)
    .where(and(userScope(user.id).events, eq(events.id, id)));

  return NextResponse.json({ ok: true, denylistInserts: denylistRows.length });
}
