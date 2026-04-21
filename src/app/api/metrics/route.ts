import { NextRequest, NextResponse } from "next/server";
import { upsertMetric, type MetricInput } from "@/lib/ingest-service";

/**
 * POST /api/metrics - manually create a single metric row.
 * Body: { metricTypeId, value, recordedAt, source?, sourceId? }
 * Defaults: source="manual", sourceId=null.
 */
export async function POST(request: NextRequest) {
  let body: Partial<MetricInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.metricTypeId || typeof body.metricTypeId !== "number") {
    return NextResponse.json({ error: "metricTypeId required" }, { status: 400 });
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return NextResponse.json({ error: "value must be a finite number" }, { status: 400 });
  }
  if (!body.recordedAt || typeof body.recordedAt !== "string") {
    return NextResponse.json({ error: "recordedAt (ISO) required" }, { status: 400 });
  }

  const status = await upsertMetric({
    metricTypeId: body.metricTypeId,
    value: body.value,
    recordedAt: body.recordedAt,
    source: body.source ?? "manual",
    sourceId: body.sourceId ?? null,
  });
  return NextResponse.json({ status });
}
