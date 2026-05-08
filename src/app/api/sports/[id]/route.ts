import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, goals, metricTypes, sports } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * DELETE /api/sports/:id
 *
 * Allowed only when no rows reference this sport from the three tables
 * with NOT NULL FKs: events, goals, metric_types. dashboards.sport_id
 * is nullable + ON DELETE SET NULL — those rows survive with their
 * sport-color dot cleared. Returns 409 with the blocking counts when
 * NOT NULL refs exist so the UI can show a useful message.
 *
 * Mirrors the policy in src/app/api/metric-types/[id]/route.ts.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [ev, gl, mt] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(events).where(eq(events.sportId, id)),
    db.select({ c: sql<number>`count(*)` }).from(goals).where(eq(goals.sportId, id)),
    db
      .select({ c: sql<number>`count(*)` })
      .from(metricTypes)
      .where(eq(metricTypes.sportId, id)),
  ]);
  const counts = {
    events: Number(ev[0]?.c ?? 0),
    goals: Number(gl[0]?.c ?? 0),
    metricTypes: Number(mt[0]?.c ?? 0),
  };
  const total = counts.events + counts.goals + counts.metricTypes;
  if (total > 0) {
    return NextResponse.json(
      { error: "sport still referenced", counts },
      { status: 409 },
    );
  }

  const result = await db
    .delete(sports)
    .where(eq(sports.id, id))
    .returning({ id: sports.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "sport not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
