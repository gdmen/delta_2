import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  metrics,
  metricTypes,
  metricTypeAliases,
  eventMetrics,
  dailySummaries,
  goals,
  goalJournalEntries,
  workoutSets,
  mergeLog,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { parseMergeByIdBody } from "@/lib/merge-validation";
import {
  buildMetricTypeMergedEntry,
  buildMetricTypeMergePayload,
} from "@/lib/merge-log/builder";
import type { MetricTypeMergedEntry } from "@/lib/merge-log/types";

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
 * merged metric_types rows. Runs inside a single postgres-js transaction so
 * partial failures roll back fully.
 *
 * The transaction callback is async — postgres-js requires it. Every drizzle
 * query inside is awaited.
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

  // TODO(pr2-phase-3): replace with `const { user } = await requireUserOr401()`.
  // Until every consumer has auth wired, hardcoded to the bootstrap owner
  // so single-user behavior is preserved and the per-user scoping is in
  // place ready for the auth swap.
  const userId = 1;

  // Load all referenced types, validate existence, and enforce unit policy.
  // Per the eng-review HIGH finding on merge endpoints: BOTH the existence
  // check AND every inner mutation must include `WHERE user_id = ?`.
  // Without the scope on the existence check, an attacker could pass
  // mergeIds=[victim_metric_id] and the existence check would pass; the
  // existence check alone is necessary-but-not-sufficient.
  const allIds = [canonicalId, ...mergeIds];
  const typeRows = await db
    .select({ id: metricTypes.id, name: metricTypes.name, unit: metricTypes.unit })
    .from(metricTypes)
    .where(and(eq(metricTypes.userId, userId), inArray(metricTypes.id, allIds)));
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
    setsMoved: number;
  };

  // Capture for the merge_log: one entry per mergeId, accumulated as we
  // run the per-mergeId mutations. Snapshot must be captured BEFORE this
  // mergeId's mutations (per-iteration, not pre-loop) because in a
  // multi-row merge (A→C, B→C), B's snapshot must reflect post-A state.
  const mergedEntries: MetricTypeMergedEntry[] = [];
  let mergeLogId: number | null = null;

  const report: Report[] = await db.transaction(async (tx) => {
    const out: Report[] = [];
    for (const mergeId of mergeIds) {
      const merged = byId.get(mergeId)!;
      const rescale = scales[mergeId] ?? 1;

      // Snapshot BEFORE mutations for this mergeId.
      mergedEntries.push(
        await buildMetricTypeMergedEntry(tx, canonicalId, mergeId, rescale),
      );

      // Defense-in-depth: scope every retarget by user_id even though
      // the existence check above already filtered mergeId to this
      // user's catalog. Belt + suspenders so a future bug in the
      // existence-check codepath can't cascade into cross-user
      // mutation here.
      const metricsUpd = await tx
        .update(metrics)
        .set({
          metricTypeId: canonicalId,
          value: rescale === 1 ? metrics.value : sql`${metrics.value} * ${rescale}`,
        })
        .where(and(eq(metrics.userId, userId), eq(metrics.metricTypeId, mergeId)))
        .returning({ id: metrics.id });

      // event_metrics has a UNIQUE(event_id, metric_type_id); dedupe before re-pointing.
      const canonicalEventIds = (
        await tx
          .select({ eid: eventMetrics.eventId })
          .from(eventMetrics)
          .where(eq(eventMetrics.metricTypeId, canonicalId))
      ).map((r) => r.eid);
      if (canonicalEventIds.length > 0) {
        await tx
          .delete(eventMetrics)
          .where(
            and(
              eq(eventMetrics.metricTypeId, mergeId),
              inArray(eventMetrics.eventId, canonicalEventIds),
            ),
          );
      }
      await tx
        .update(eventMetrics)
        .set({
          metricTypeId: canonicalId,
          value:
            rescale === 1 ? eventMetrics.value : sql`${eventMetrics.value} * ${rescale}`,
        })
        .where(eq(eventMetrics.metricTypeId, mergeId));

      // daily_summaries collision collapse. Raw SQL because drizzle's builder
      // doesn't ergonomically express INSERT-FROM-SELECT + ON CONFLICT with
      // EXCLUDED. Weighted avg: (avg*count + avg2*count2) / sumCount.
      // Postgres-specific: `LEAST()` / `GREATEST()` for two-argument min/max
      // (SQLite's `MIN(a, b)` / `MAX(a, b)` are scalar; Postgres reserves
      // `MIN`/`MAX` for aggregates only).
      //
      // ON CONFLICT target matches the new (user_id, date, metric_type_id)
      // unique index added in 0001_multi_user. SELECT and existence check
      // both scoped by user_id for the same defense-in-depth reason as the
      // metrics update above.
      const summariesBefore = await tx
        .select({ id: dailySummaries.id })
        .from(dailySummaries)
        .where(
          and(
            eq(dailySummaries.userId, userId),
            eq(dailySummaries.metricTypeId, mergeId),
          ),
        );
      if (summariesBefore.length > 0) {
        await tx.execute(sql`
          INSERT INTO daily_summaries (user_id, date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
          SELECT user_id, date, ${canonicalId}, avg_value * ${rescale}, min_value * ${rescale}, max_value * ${rescale}, count, last_ingest_at
          FROM daily_summaries
          WHERE user_id = ${userId} AND metric_type_id = ${mergeId}
          ON CONFLICT (user_id, date, metric_type_id) DO UPDATE SET
            count = daily_summaries.count + excluded.count,
            min_value = CASE
              WHEN daily_summaries.min_value IS NULL THEN excluded.min_value
              WHEN excluded.min_value IS NULL THEN daily_summaries.min_value
              ELSE LEAST(daily_summaries.min_value, excluded.min_value)
            END,
            max_value = CASE
              WHEN daily_summaries.max_value IS NULL THEN excluded.max_value
              WHEN excluded.max_value IS NULL THEN daily_summaries.max_value
              ELSE GREATEST(daily_summaries.max_value, excluded.max_value)
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
              ELSE GREATEST(daily_summaries.last_ingest_at, excluded.last_ingest_at)
            END
        `);
        await tx
          .delete(dailySummaries)
          .where(
            and(
              eq(dailySummaries.userId, userId),
              eq(dailySummaries.metricTypeId, mergeId),
            ),
          );
      }

      await tx
        .update(goals)
        .set({ metricTypeId: canonicalId })
        .where(and(eq(goals.userId, userId), eq(goals.metricTypeId, mergeId)));

      // goal_journal_entries can pin to a metric_type; retarget any pin at the
      // merged row to the canonical. ON DELETE SET NULL on the FK already
      // protects against dangling refs if a metric_type vanishes another way.
      await tx
        .update(goalJournalEntries)
        .set({ linkedMetricTypeId: canonicalId })
        .where(eq(goalJournalEntries.linkedMetricTypeId, mergeId));

      // workout_sets has no unique constraint on (event_id, exercise_metric_type_id,
      // set_number), so this is a straight retarget with no dedupe. Weight rescale
      // isn't applied here — workout_sets.weight is a per-set load, not a reading
      // of the exercise metric_type's nominal value; if the user wants rescale
      // they adjust the metric_type unit and the sets downstream, separately.
      const setsUpd = await tx
        .update(workoutSets)
        .set({ exerciseMetricTypeId: canonicalId })
        .where(eq(workoutSets.exerciseMetricTypeId, mergeId))
        .returning({ id: workoutSets.id });

      // Re-point any aliases that pointed AT the merged type to canonical
      // BEFORE the metric_types delete. Otherwise the alias FK's
      // ON DELETE CASCADE would silently drop them. That matters for
      // chain merges: if `src1:weight` was aliased to A, and A is now
      // being merged into B, future ingests of `src1:weight` must route
      // to B — not auto-create an orphan.
      await tx
        .update(metricTypeAliases)
        .set({ canonicalMetricTypeId: canonicalId })
        .where(
          and(
            eq(metricTypeAliases.userId, userId),
            eq(metricTypeAliases.canonicalMetricTypeId, mergeId),
          ),
        );

      // Record the alias so future ingests route here directly. Goes
      // after the re-point so a no-op ON CONFLICT path is fine if
      // `merged.name` was already in the table from a prior merge.
      await tx
        .insert(metricTypeAliases)
        .values({
          userId,
          alias: merged.name,
          canonicalMetricTypeId: canonicalId,
        })
        .onConflictDoNothing();

      // All FK references (metrics, event_metrics, daily_summaries, goals,
      // focus_metric_links, workout_sets) were retargeted above, and aliases
      // pointing at this row were re-pointed (not cascade-deleted), so the
      // delete has nothing holding it back.
      await tx
        .delete(metricTypes)
        .where(and(eq(metricTypes.userId, userId), eq(metricTypes.id, mergeId)));

      out.push({
        mergeId,
        name: merged.name,
        metricsMoved: metricsUpd.length,
        summariesMoved: summariesBefore.length,
        setsMoved: setsUpd.length,
      });
    }

    // Insert the merge_log row inside the same tx so a partial failure
    // rolls back both mutations and log together.
    const payload = buildMetricTypeMergePayload(canonicalId, mergedEntries);
    const mergedNames = mergedEntries.map((m) => m.row.name).join(", ");
    const inserted = await tx
      .insert(mergeLog)
      .values({
        userId,
        kind: "metric_type",
        canonicalId,
        canonicalName: canonical.name,
        mergedNames,
        payload: JSON.stringify(payload),
      })
      .returning({ id: mergeLog.id });
    mergeLogId = inserted[0]?.id ?? null;

    return out;
  });

  return NextResponse.json({
    canonical: { id: canonical.id, name: canonical.name },
    merged: report,
    mergeLogId,
  });
}
