import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  metrics,
  metricTypes,
  metricTypeAliases,
  eventMetrics,
  dailySummaries,
  goals,
  focusMetricLinks,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { parseMergeByIdBody } from "@/lib/merge-validation";

/**
 * POST /api/metric-types/merge
 * Body: {
 *   canonicalId: number,
 *   mergeIds: number[],
 *   unitPolicy?: "block" | "rescale",
 *   scales?: Record<number, number>,  // mergeId -> multiplier
 * }
 *
 * Rewrites every FK referencing one of mergeIds to canonicalId, aggregates
 * daily_summaries collisions, pre-dedupes event_metrics and focus_metric_links
 * collisions, inserts alias rows under each merged name, and deletes the
 * merged metric_types rows. Runs inside a single better-sqlite3 transaction
 * so partial failures roll back fully.
 *
 * The transaction callback is SYNCHRONOUS — better-sqlite3 rejects async
 * callbacks ("Transaction function cannot return a promise"). Drizzle's
 * query builders are sync-dispatched when invoked via explicit `.all()` /
 * `.run()` / `.get()` / `.returning().all()` methods inside the tx.
 */
export async function POST(request: NextRequest) {
  let body: {
    canonicalId?: number;
    mergeIds?: number[];
    unitPolicy?: "block" | "rescale";
    scales?: Record<string, number>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseMergeByIdBody(body);
  if (!parsed.ok) return parsed.response;
  const { canonicalId, mergeIds } = parsed.value;
  const unitPolicy = body.unitPolicy ?? "block";
  const scales: Record<number, number> = {};
  if (body.scales) {
    for (const [k, v] of Object.entries(body.scales)) {
      scales[Number(k)] = Number(v);
    }
  }

  // Load all referenced types, validate existence, and enforce unit policy.
  const allIds = [canonicalId, ...mergeIds];
  const typeRows = await db
    .select({ id: metricTypes.id, name: metricTypes.name, unit: metricTypes.unit })
    .from(metricTypes)
    .where(inArray(metricTypes.id, allIds));
  const byId = new Map(typeRows.map((r) => [r.id, r]));
  const canonical = byId.get(canonicalId);
  if (!canonical) {
    return NextResponse.json({ error: "canonicalId not found" }, { status: 404 });
  }
  const mergedTypes = mergeIds.map((id) => byId.get(id));
  if (mergedTypes.some((t) => !t)) {
    return NextResponse.json(
      { error: "One or more mergeIds not found" },
      { status: 404 }
    );
  }

  if (unitPolicy === "block") {
    const mismatched = mergedTypes.filter((t) => t!.unit !== canonical.unit);
    if (mismatched.length > 0) {
      return NextResponse.json(
        {
          error: "Unit mismatch — set unitPolicy:'rescale' with scales per merge id",
          canonical: { id: canonical.id, unit: canonical.unit },
          mismatched: mismatched.map((t) => ({ id: t!.id, name: t!.name, unit: t!.unit })),
        },
        { status: 400 }
      );
    }
  } else if (unitPolicy === "rescale") {
    const missing = mergeIds.filter(
      (id) => !Number.isFinite(scales[id]) || scales[id] === 0
    );
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `scales missing or zero for mergeIds: ${missing.join(", ")}` },
        { status: 400 }
      );
    }
  }

  type Report = {
    mergeId: number;
    name: string;
    metricsMoved: number;
    summariesMoved: number;
  };

  const report: Report[] = db.transaction((tx) => {
    const out: Report[] = [];
    for (const mergeId of mergeIds) {
      const merged = byId.get(mergeId)!;
      const rescale = scales[mergeId] ?? 1;

      const metricsUpd = tx
        .update(metrics)
        .set({
          metricTypeId: canonicalId,
          value: rescale === 1 ? metrics.value : sql`${metrics.value} * ${rescale}`,
        })
        .where(eq(metrics.metricTypeId, mergeId))
        .returning({ id: metrics.id })
        .all();

      // event_metrics has a UNIQUE(event_id, metric_type_id); dedupe before re-pointing.
      const canonicalEventIds = tx
        .select({ eid: eventMetrics.eventId })
        .from(eventMetrics)
        .where(eq(eventMetrics.metricTypeId, canonicalId))
        .all()
        .map((r) => r.eid);
      if (canonicalEventIds.length > 0) {
        tx
          .delete(eventMetrics)
          .where(
            and(
              eq(eventMetrics.metricTypeId, mergeId),
              inArray(eventMetrics.eventId, canonicalEventIds)
            )
          )
          .run();
      }
      tx
        .update(eventMetrics)
        .set({
          metricTypeId: canonicalId,
          value:
            rescale === 1 ? eventMetrics.value : sql`${eventMetrics.value} * ${rescale}`,
        })
        .where(eq(eventMetrics.metricTypeId, mergeId))
        .run();

      // daily_summaries collision collapse. Raw SQL because drizzle's builder
      // doesn't ergonomically express INSERT-FROM-SELECT + ON CONFLICT with
      // an aliased `excluded` row. Weighted avg: (avg*count + avg2*count2) / sumCount.
      const summariesBefore = tx
        .select({ id: dailySummaries.id })
        .from(dailySummaries)
        .where(eq(dailySummaries.metricTypeId, mergeId))
        .all();
      if (summariesBefore.length > 0) {
        tx.run(sql`
          INSERT INTO daily_summaries (date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
          SELECT date, ${canonicalId}, avg_value * ${rescale}, min_value * ${rescale}, max_value * ${rescale}, count, last_ingest_at
          FROM daily_summaries
          WHERE metric_type_id = ${mergeId}
          ON CONFLICT(date, metric_type_id) DO UPDATE SET
            count = daily_summaries.count + excluded.count,
            min_value = CASE
              WHEN daily_summaries.min_value IS NULL THEN excluded.min_value
              WHEN excluded.min_value IS NULL THEN daily_summaries.min_value
              ELSE MIN(daily_summaries.min_value, excluded.min_value)
            END,
            max_value = CASE
              WHEN daily_summaries.max_value IS NULL THEN excluded.max_value
              WHEN excluded.max_value IS NULL THEN daily_summaries.max_value
              ELSE MAX(daily_summaries.max_value, excluded.max_value)
            END,
            avg_value = CASE
              WHEN (daily_summaries.count + excluded.count) = 0 THEN NULL
              ELSE (
                COALESCE(daily_summaries.avg_value, 0) * daily_summaries.count
                + COALESCE(excluded.avg_value, 0) * excluded.count
              ) / (daily_summaries.count + excluded.count)
            END,
            last_ingest_at = CASE
              WHEN daily_summaries.last_ingest_at IS NULL THEN excluded.last_ingest_at
              WHEN excluded.last_ingest_at IS NULL THEN daily_summaries.last_ingest_at
              ELSE MAX(daily_summaries.last_ingest_at, excluded.last_ingest_at)
            END
        `);
        tx.delete(dailySummaries).where(eq(dailySummaries.metricTypeId, mergeId)).run();
      }

      tx.update(goals).set({ metricTypeId: canonicalId }).where(eq(goals.metricTypeId, mergeId)).run();

      // focus_metric_links has no unique constraint; dedupe by (focus_id, metric_type_id).
      const canonicalFocusIds = tx
        .select({ fid: focusMetricLinks.focusId })
        .from(focusMetricLinks)
        .where(eq(focusMetricLinks.metricTypeId, canonicalId))
        .all()
        .map((r) => r.fid);
      if (canonicalFocusIds.length > 0) {
        tx
          .delete(focusMetricLinks)
          .where(
            and(
              eq(focusMetricLinks.metricTypeId, mergeId),
              inArray(focusMetricLinks.focusId, canonicalFocusIds)
            )
          )
          .run();
      }
      tx
        .update(focusMetricLinks)
        .set({ metricTypeId: canonicalId })
        .where(eq(focusMetricLinks.metricTypeId, mergeId))
        .run();

      // Record the alias so future ingests route here directly.
      tx
        .insert(metricTypeAliases)
        .values({ alias: merged.name, canonicalMetricTypeId: canonicalId })
        .onConflictDoNothing()
        .run();

      // ON DELETE CASCADE on the alias FK auto-cleans any aliases that
      // pointed AT this merged type.
      tx.delete(metricTypes).where(eq(metricTypes.id, mergeId)).run();

      out.push({
        mergeId,
        name: merged.name,
        metricsMoved: metricsUpd.length,
        summariesMoved: summariesBefore.length,
      });
    }
    return out;
  });

  return NextResponse.json({
    canonical: { id: canonical.id, name: canonical.name },
    merged: report,
  });
}
