import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metrics, metricScheduleSkips } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";
import { recomputeDailySummary } from "@/lib/ingest-service";

interface UpdateMetricBody {
  value?: number;
  recordedAt?: string;
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

  let body: UpdateMetricBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof metrics.$inferInsert> = {};
  if (body.value !== undefined) {
    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return NextResponse.json({ error: "value must be a finite number" }, { status: 400 });
    }
    updates.value = body.value;
  }
  if (body.recordedAt !== undefined) {
    if (typeof body.recordedAt !== "string" || !body.recordedAt) {
      return NextResponse.json({ error: "recordedAt must be a non-empty string" }, { status: 400 });
    }
    updates.recordedAt = body.recordedAt;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Capture the pre-update (date, metric_type_id) so we know which
  // daily_summaries cell(s) need a recompute after the write.
  const before = await db
    .select({ recordedAt: metrics.recordedAt, metricTypeId: metrics.metricTypeId })
    .from(metrics)
    .where(and(userScope(user.id).metrics, eq(metrics.id, id)))
    .limit(1);
  if (before.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db
    .update(metrics)
    .set(updates)
    .where(and(userScope(user.id).metrics, eq(metrics.id, id)));

  // Recompute the new cell (post-edit) and, if recordedAt crossed a
  // day boundary, the old cell too. metricTypeId is immutable on PATCH
  // today; the simple comparison is enough.
  const newRecordedAt = updates.recordedAt ?? before[0].recordedAt;
  await recomputeDailySummary(user.id, before[0].metricTypeId, newRecordedAt);
  if (before[0].recordedAt.slice(0, 10) !== newRecordedAt.slice(0, 10)) {
    await recomputeDailySummary(user.id, before[0].metricTypeId, before[0].recordedAt);
  }

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

  // Same pre-read shape as PATCH — we need the cell coordinates to
  // recompute after the row is gone. Pulls source + sourceId too so we
  // can detect "this was a scheduled auto-log" and write a skip
  // tombstone instead of letting the next materializer recreate it.
  const before = await db
    .select({
      recordedAt: metrics.recordedAt,
      metricTypeId: metrics.metricTypeId,
      source: metrics.source,
      sourceId: metrics.sourceId,
    })
    .from(metrics)
    .where(and(userScope(user.id).metrics, eq(metrics.id, id)))
    .limit(1);

  await db
    .delete(metrics)
    .where(and(userScope(user.id).metrics, eq(metrics.id, id)));

  if (before.length > 0) {
    const row = before[0];

    // Scheduled rows have `source_id = 'schedule:<typeId>:<localDate>'`.
    // Parse the localDate out and tombstone (typeId, date) so the lazy
    // materializer doesn't re-create the row on the next request.
    // ON CONFLICT DO NOTHING keeps repeated deletes harmless.
    if (row.source === "scheduled" && row.sourceId) {
      const m = row.sourceId.match(/^schedule:(\d+):(\d{4}-\d{2}-\d{2})$/);
      if (m) {
        const typeId = parseInt(m[1], 10);
        const localDate = m[2];
        if (typeId === row.metricTypeId) {
          await db
            .insert(metricScheduleSkips)
            .values({ metricTypeId: typeId, skippedDate: localDate })
            .onConflictDoNothing();
        }
      }
    }

    await recomputeDailySummary(user.id, row.metricTypeId, row.recordedAt);
  }

  return NextResponse.json({ ok: true });
}
