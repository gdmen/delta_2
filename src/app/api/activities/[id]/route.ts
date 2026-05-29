import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, goals, metricTypes, activities } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * DELETE /api/activities/:id
 *
 * Allowed only when no rows reference this activity from the three tables
 * with NOT NULL FKs: events, goals, metric_types. dashboards.activity_id
 * is nullable + ON DELETE SET NULL — those rows survive with their
 * activity-color dot cleared. Returns 409 with the blocking counts when
 * NOT NULL refs exist so the UI can show a useful message.
 *
 * Mirrors the policy in src/app/api/metric-types/[id]/route.ts.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [ev, gl, mt] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)` })
      .from(events)
      .where(and(userScope(user.id).events, eq(events.activityId, id))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(goals)
      .where(and(userScope(user.id).goals, eq(goals.activityId, id))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(metricTypes)
      .where(and(userScope(user.id).metricTypes, eq(metricTypes.activityId, id))),
  ]);
  const counts = {
    events: Number(ev[0]?.c ?? 0),
    goals: Number(gl[0]?.c ?? 0),
    metricTypes: Number(mt[0]?.c ?? 0),
  };
  const total = counts.events + counts.goals + counts.metricTypes;
  if (total > 0) {
    return NextResponse.json(
      { error: "activity still referenced", counts },
      { status: 409 },
    );
  }

  const result = await db
    .delete(activities)
    .where(and(userScope(user.id).activities, eq(activities.id, id)))
    .returning({ id: activities.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "activity not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
