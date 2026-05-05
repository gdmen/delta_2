import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  eventMetrics,
  goals,
  metricTypes,
  metrics,
  workoutSets,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

interface UpdateMetricTypeBody {
  /** Target value. Pass null to clear (== "no target"). */
  target?: number | null;
  /** Direction of the target. */
  higherIsBetter?: boolean;
}

/**
 * PATCH /api/metric-types/:id
 *
 * Edit the metric_type row's target + direction. The metric detail page
 * uses this; widgets read both fields automatically via metric-history's
 * `loadType()` so saving here is the single source of truth.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: UpdateMetricTypeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof metricTypes.$inferInsert> = {};
  if (body.target !== undefined) {
    if (body.target !== null && (typeof body.target !== "number" || !Number.isFinite(body.target))) {
      return NextResponse.json({ error: "target must be a finite number or null" }, { status: 400 });
    }
    updates.target = body.target;
  }
  if (body.higherIsBetter !== undefined) {
    if (typeof body.higherIsBetter !== "boolean") {
      return NextResponse.json({ error: "higherIsBetter must be a boolean" }, { status: 400 });
    }
    updates.higherIsBetter = body.higherIsBetter;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const result = await db.update(metricTypes).set(updates).where(eq(metricTypes.id, id)).returning({ id: metricTypes.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "metric_type not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/metric-types/:id
 *
 * Allowed only when no rows reference this metric_type from the four
 * tables that have RESTRICT-style FKs: metrics, workout_sets,
 * event_metrics, goals. Aliases cascade (their existence shouldn't
 * block) and journal entry refs are set-null. Returns 409 with the
 * blocking counts when refs exist so the UI can show a useful message.
 *
 * Computed metric_types (e.g. bench_press_max) have no rows in metrics
 * but the seed will recreate them on the next run — that's fine, since
 * the metric carries no stored values to lose. The user is in charge
 * of whether deletion is intended.
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

  const [m, ws, em, g] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(metrics).where(eq(metrics.metricTypeId, id)),
    db.select({ c: sql<number>`count(*)` }).from(workoutSets).where(eq(workoutSets.exerciseMetricTypeId, id)),
    db.select({ c: sql<number>`count(*)` }).from(eventMetrics).where(eq(eventMetrics.metricTypeId, id)),
    db.select({ c: sql<number>`count(*)` }).from(goals).where(eq(goals.metricTypeId, id)),
  ]);
  const counts = {
    metrics: Number(m[0]?.c ?? 0),
    workoutSets: Number(ws[0]?.c ?? 0),
    eventMetrics: Number(em[0]?.c ?? 0),
    goals: Number(g[0]?.c ?? 0),
  };
  const total = counts.metrics + counts.workoutSets + counts.eventMetrics + counts.goals;
  if (total > 0) {
    return NextResponse.json(
      {
        error: "metric_type still referenced",
        counts,
      },
      { status: 409 },
    );
  }

  const result = await db
    .delete(metricTypes)
    .where(eq(metricTypes.id, id))
    .returning({ id: metricTypes.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "metric_type not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
