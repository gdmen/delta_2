import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importSources, metrics, metricTypes } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * POST /api/import-sources/[id]/migrate
 * Body: { renames: [{ from, to }, ...] }
 *
 * For each rename, move rows of this source from the `from` metric_type
 * to the `to` metric_type (creating `to` if needed). Deletes now-empty
 * `from` metric_types that still match the source-prefixed fallback form
 * (e.g. "fitnotes_bodyweight:body_weight"); canonical types are always
 * preserved.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const srcRows = await db.select().from(importSources).where(eq(importSources.id, id)).limit(1);
  if (srcRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sourceTag = srcRows[0].name.toLowerCase().replace(/\s+/g, "_");

  let body: { renames?: { from: string; to: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const renames = body.renames ?? [];

  const result: { from: string; to: string; moved: number; removedOrphan: boolean }[] = [];

  for (const r of renames) {
    // Resolve "to" type: exact match first. Create if missing (no rows to
    // inherit unit/frequency from here, use reasonable defaults).
    let toRow = (
      await db.select({ id: metricTypes.id }).from(metricTypes).where(eq(metricTypes.name, r.to)).limit(1)
    )[0];
    if (!toRow) {
      const ins = await db
        .insert(metricTypes)
        .values({ name: r.to, unit: "", frequencyHint: "daily" })
        .returning({ id: metricTypes.id });
      toRow = ins[0];
    }

    // Resolve "from" types: both the exact name and the source-prefixed
    // variant metric-resolver falls back to.
    const candidates = await db
      .select({ id: metricTypes.id, name: metricTypes.name })
      .from(metricTypes);
    const fromEntries = candidates.filter(
      (c) => c.name === r.from || c.name === `${sourceTag}:${r.from}`
    );

    let moved = 0;
    let removedOrphan = false;
    for (const fe of fromEntries) {
      if (fe.id === toRow.id) continue; // already on the target
      const updated = await db
        .update(metrics)
        .set({ metricTypeId: toRow.id })
        .where(and(eq(metrics.source, sourceTag), eq(metrics.metricTypeId, fe.id)))
        .returning({ id: metrics.id });
      moved += updated.length;

      // If this was the source-prefixed auto-created orphan and it's now
      // referenced by zero rows total, clean it up. Never delete canonical
      // types (those without the `sourceTag:` prefix).
      if (fe.name.startsWith(`${sourceTag}:`)) {
        const remaining = await db
          .select({ c: sql<number>`count(*)` })
          .from(metrics)
          .where(eq(metrics.metricTypeId, fe.id));
        if (Number(remaining[0]?.c ?? 0) === 0) {
          await db.delete(metricTypes).where(eq(metricTypes.id, fe.id));
          removedOrphan = true;
        }
      }
    }

    result.push({ from: r.from, to: r.to, moved, removedOrphan });
  }

  return NextResponse.json({ migrations: result });
}
