import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, activities } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface UpdateEventBody {
  activityId?: number;
  type?: string;
  durationMinutes?: number | null;
  notes?: string | null;
  startedAt?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: UpdateEventBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof events.$inferInsert> = {};
  if (body.activityId !== undefined) {
    if (typeof body.activityId !== "number") {
      return NextResponse.json({ error: "activityId must be a number" }, { status: 400 });
    }
    // FK injection guard — same shape as POST /api/events. Without
    // this check, a PATCH could rewrite the event to point at a
    // foreign owner's activity, which would then surface in the JOIN
    // on the listing page.
    const ownsActivity = await db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.id, body.activityId), userScope(user.id).activities))
      .limit(1);
    if (ownsActivity.length === 0) {
      return NextResponse.json({ error: "activityId not found" }, { status: 400 });
    }
    updates.activityId = body.activityId;
  }
  if (body.type !== undefined) {
    if (typeof body.type !== "string" || !body.type) {
      return NextResponse.json({ error: "type must be a non-empty string" }, { status: 400 });
    }
    updates.type = body.type;
  }
  if (body.durationMinutes !== undefined) {
    if (body.durationMinutes !== null && (typeof body.durationMinutes !== "number" || !Number.isFinite(body.durationMinutes))) {
      return NextResponse.json({ error: "durationMinutes must be a finite number or null" }, { status: 400 });
    }
    updates.durationMinutes = body.durationMinutes;
  }
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.startedAt !== undefined) {
    if (typeof body.startedAt !== "string" || !body.startedAt) {
      return NextResponse.json({ error: "startedAt must be a non-empty string" }, { status: 400 });
    }
    updates.startedAt = body.startedAt;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db
    .update(events)
    .set(updates)
    .where(and(userScope(user.id).events, eq(events.id, id)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // Auto-unmerge cascade: if this event is a member of any composite,
  // we need to clean that up before the DELETE FK cascade tears the
  // composite into a broken state. Two paths:
  //   - composite has exactly 2 members + this is one of them
  //       -> delete the composite; flip the other member to 'visible'
  //   - composite has 3+ members
  //       -> strip this id from composite_member_ids
  // No denylist insert: the user is destroying data, not signaling
  // "not a dupe."
  const composites = await db
    .select({
      id: events.id,
      memberIds: events.compositeMemberIds,
    })
    .from(events)
    .where(
      and(
        userScope(user.id).events,
        eq(events.status, "composite"),
        sql`${id} = ANY(${events.compositeMemberIds})`,
      ),
    );
  for (const c of composites) {
    if (c.memberIds.length <= 2) {
      const others = c.memberIds.filter((mid) => mid !== id);
      // Restore the survivor BEFORE dropping the composite — if we
      // delete the composite first, the FK ON DELETE CASCADE on
      // event_duplicate_denylist won't touch our member rows, but
      // a concurrent reader could briefly see two "hidden_by_composite"
      // rows with no composite pointing at them.
      if (others.length > 0) {
        await db
          .update(events)
          .set({ status: "visible" })
          .where(
            and(
              userScope(user.id).events,
              sql`${events.id} IN (${sql.join(others.map((o) => sql`${o}`), sql`, `)})`,
            ),
          );
      }
      await db
        .delete(events)
        .where(and(userScope(user.id).events, eq(events.id, c.id)));
    } else {
      await db
        .update(events)
        .set({
          compositeMemberIds: sql`array_remove(${events.compositeMemberIds}, ${id})`,
        })
        .where(and(userScope(user.id).events, eq(events.id, c.id)));
    }
  }

  // Cascades to workout_sets and event_metrics via FK ON DELETE CASCADE.
  // event_duplicate_denylist rows referencing this id also CASCADE-clean.
  await db
    .delete(events)
    .where(and(userScope(user.id).events, eq(events.id, id)));
  return NextResponse.json({ ok: true });
}
