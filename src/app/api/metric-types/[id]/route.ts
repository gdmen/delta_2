import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metricTypes } from "@/db/schema";
import { eq } from "drizzle-orm";

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
