import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  sports,
  events,
  focuses,
  goals,
  metricTypes,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * POST /api/sports/merge
 * Body: { canonicalId: number, mergeIds: number[] }
 *
 * Re-points every sport_id FK from merged → canonical and deletes the merged
 * sports. Simpler than the metric-types merge: no unit mismatch, no aliases
 * table (cross-source sport canonicalization lives at the source-mapping
 * layer, not the DB), no daily_summaries.
 */
export async function POST(request: NextRequest) {
  let body: { canonicalId?: number; mergeIds?: number[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const canonicalId = Number(body.canonicalId);
  const mergeIds = Array.isArray(body.mergeIds)
    ? body.mergeIds.map(Number).filter((n) => Number.isFinite(n))
    : [];

  if (!Number.isFinite(canonicalId) || canonicalId <= 0) {
    return NextResponse.json({ error: "canonicalId is required" }, { status: 400 });
  }
  if (mergeIds.length === 0) {
    return NextResponse.json({ error: "mergeIds must be non-empty" }, { status: 400 });
  }
  if (mergeIds.includes(canonicalId)) {
    return NextResponse.json(
      { error: "canonicalId cannot be in mergeIds" },
      { status: 400 },
    );
  }

  const allIds = [canonicalId, ...mergeIds];
  const rows = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(inArray(sports.id, allIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const canonical = byId.get(canonicalId);
  if (!canonical) {
    return NextResponse.json({ error: "canonicalId not found" }, { status: 404 });
  }
  if (mergeIds.some((id) => !byId.has(id))) {
    return NextResponse.json(
      { error: "One or more mergeIds not found" },
      { status: 404 },
    );
  }

  type Report = { mergeId: number; name: string; eventsMoved: number };

  const report: Report[] = db.transaction((tx) => {
    const out: Report[] = [];
    for (const mergeId of mergeIds) {
      const merged = byId.get(mergeId)!;

      const eventsUpd = tx
        .update(events)
        .set({ sportId: canonicalId })
        .where(eq(events.sportId, mergeId))
        .returning({ id: events.id })
        .all();

      tx.update(focuses).set({ sportId: canonicalId }).where(eq(focuses.sportId, mergeId)).run();
      tx.update(goals).set({ sportId: canonicalId }).where(eq(goals.sportId, mergeId)).run();
      tx
        .update(metricTypes)
        .set({ sportId: canonicalId })
        .where(eq(metricTypes.sportId, mergeId))
        .run();

      tx.delete(sports).where(eq(sports.id, mergeId)).run();

      out.push({ mergeId, name: merged.name, eventsMoved: eventsUpd.length });
    }
    return out;
  });

  return NextResponse.json({
    canonical: { id: canonical.id, name: canonical.name },
    merged: report,
  });
}
