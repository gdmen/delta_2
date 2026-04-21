import { NextRequest, NextResponse } from "next/server";
import { upsertEventMetric } from "@/lib/ingest-service";

interface UpsertEventMetricBody {
  eventId: number;
  metricTypeId: number;
  value: number;
}

/**
 * POST /api/event-metrics - upsert one (eventId, metricTypeId) row.
 * Used for both create and edit; the sidecar table's uniqueness is
 * the (event_id, metric_type_id) pair so upsert is the natural verb.
 */
export async function POST(request: NextRequest) {
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

  const status = await upsertEventMetric(body.eventId, body.metricTypeId, body.value);
  return NextResponse.json({ status });
}
