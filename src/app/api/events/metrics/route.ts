import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventMetrics, metricTypes, events } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";

export interface EventMetric {
  name: string;
  unit: string | null;
  value: number;
}

/**
 * GET /api/events/metrics?ids=1,2,3
 *
 * Batch fetch the per-event numeric metrics (event_metrics joined to
 * metric_types) for a handful of event ids. Powers the composite-merge
 * modal, which shows each member's metrics so the user can compare
 * recordings (e.g. which Strava ride has the real distance/duration)
 * before merging.
 *
 * Returns `{ metrics: { [eventId]: [{ name, unit, value }, ...] } }`,
 * each event's list ordered by metric-type name. Scoped to the caller's
 * own events via an inner join on `events.user_id`; ids the user doesn't
 * own are silently absent from the result.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "ids query param must list one or more event ids" },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      eventId: eventMetrics.eventId,
      name: metricTypes.name,
      unit: metricTypes.unit,
      value: eventMetrics.value,
    })
    .from(eventMetrics)
    .innerJoin(metricTypes, eq(eventMetrics.metricTypeId, metricTypes.id))
    .innerJoin(events, eq(eventMetrics.eventId, events.id))
    .where(and(eq(events.userId, user.id), inArray(eventMetrics.eventId, ids)))
    .orderBy(asc(metricTypes.name));

  const metrics: Record<number, EventMetric[]> = {};
  for (const r of rows) {
    (metrics[r.eventId] ??= []).push({
      name: r.name,
      unit: r.unit,
      value: r.value,
    });
  }

  return NextResponse.json({ metrics });
}
