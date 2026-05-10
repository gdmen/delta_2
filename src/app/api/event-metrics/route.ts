import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { upsertEventMetric } from "@/lib/ingest-service";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface UpsertEventMetricBody {
  eventId: number;
  metricTypeId: number;
  value: number;
}

/**
 * POST /api/event-metrics - upsert one (eventId, metricTypeId) row.
 * Used for both create and edit; the sidecar table's uniqueness is
 * the (event_id, metric_type_id) pair so upsert is the natural verb.
 *
 * event_metrics is INHERIT — confirm the parent event belongs to this user
 * before upserting (otherwise an attacker could attach a metric onto
 * another user's event by guessing the id).
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: Partial<UpsertEventMetricBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.eventId !== "number" || typeof body.metricTypeId !== "number") {
    return NextResponse.json({ error: "eventId and metricTypeId required" }, { status: 400 });
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return NextResponse.json({ error: "value must be a finite number" }, { status: 400 });
  }

  // INHERIT scoping: confirm the event belongs to this user.
  const owns = await db
    .select({ id: events.id })
    .from(events)
    .where(and(userScope(user.id).events, eq(events.id, body.eventId)))
    .limit(1);
  if (owns.length === 0) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  const status = await upsertEventMetric(body.eventId, body.metricTypeId, body.value);
  return NextResponse.json({ status });
}
