import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  events,
  importSources,
  metrics,
  reconcileLog,
  sourceSettings,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { ImportMapping } from "@/lib/import-mapping";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const rows = await db.select().from(importSources).where(eq(importSources.id, id)).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = rows[0];
  return NextResponse.json({
    id: r.id,
    name: r.name,
    kind: r.kind,
    mapping: JSON.parse(r.mapping) as ImportMapping,
    createdAt: r.createdAt,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { name?: string; kind?: string; mapping?: ImportMapping };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof importSources.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.kind !== undefined) {
    if (!["metrics", "events", "workout_sets"].includes(body.kind)) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }
    updates.kind = body.kind as "metrics" | "events" | "workout_sets";
  }
  if (body.mapping !== undefined) updates.mapping = JSON.stringify(body.mapping);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db.update(importSources).set(updates).where(eq(importSources.id, id));
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/import-sources/:id
 *
 * Tear the source down completely: every metrics + events row tagged
 * with this source, the cascading event_metrics + workout_sets + the
 * reconcile_log audit trail, the source_settings row, and finally the
 * import_sources config row itself.
 *
 * NOT touched: metric_types whose names start with `${sourceTag}:`. The
 * orphan rows can be reused by other paths or kept for history; deleting
 * the source isn't an instruction to nuke the catalog. Use
 * /api/metric-types/:id (or the UI) if you want them gone.
 *
 * Returns the per-table delete counts so the UI can confirm what went.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // Look up the source first so we can compute the same `sourceTag`
  // string that ingest writes into metrics/events.source.
  const rows = await db
    .select({ name: importSources.name })
    .from(importSources)
    .where(eq(importSources.id, id))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sourceTag = rows[0].name.toLowerCase().replace(/\s+/g, "_");

  // Pre-count for the response payload.
  const [m] = await db
    .select({ c: sql<number>`count(*)` })
    .from(metrics)
    .where(eq(metrics.source, sourceTag));
  const [e] = await db
    .select({ c: sql<number>`count(*)` })
    .from(events)
    .where(eq(events.source, sourceTag));
  const [r] = await db
    .select({ c: sql<number>`count(*)` })
    .from(reconcileLog)
    .where(eq(reconcileLog.source, sourceTag));

  // Delete metrics first (no children). Then events — workout_sets and
  // event_metrics cascade via FK ON DELETE CASCADE on event_id. Then
  // the operational + config rows. Each statement is its own implicit
  // txn (better-sqlite3-drizzle rejects async tx callbacks); a partial
  // failure leaves the source half-deleted, which the user can fix by
  // retrying — the operations are idempotent.
  await db.delete(metrics).where(eq(metrics.source, sourceTag));
  await db.delete(events).where(eq(events.source, sourceTag));
  await db.delete(reconcileLog).where(eq(reconcileLog.source, sourceTag));
  await db.delete(sourceSettings).where(eq(sourceSettings.source, sourceTag));
  await db.delete(importSources).where(eq(importSources.id, id));

  return NextResponse.json({
    ok: true,
    sourceTag,
    deleted: {
      metrics: Number(m?.c ?? 0),
      events: Number(e?.c ?? 0),
      reconcileLog: Number(r?.c ?? 0),
    },
  });
}
