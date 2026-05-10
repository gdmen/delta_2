import { NextRequest, NextResponse } from "next/server";
import { upsertMetric, type MetricInput } from "@/lib/ingest-service";
import { requireUserOr401 } from "@/lib/auth/require";

/**
 * POST /api/metrics - manually create a single metric row.
 * Body: { metricTypeId, value, recordedAt, source?, sourceId? }
 * Defaults: source="manual", sourceId=null.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

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
    userId: user.id,
    metricTypeId: body.metricTypeId,
    value: body.value,
    recordedAt: body.recordedAt,
    source: body.source ?? "manual",
    sourceId: body.sourceId ?? null,
    // Manual entries didn't go through the resolver, so there's no
    // alias to record. Chain-undo of merges leaves these rows alone
    // (NULL alias doesn't match any aliasesRepointed list).
    alias: null,
  });
  return NextResponse.json({ status });
}
