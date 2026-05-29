import {
  metricTypes,
  metricTypeAliases,
  metrics,
  eventMetrics,
  dailySummaries,
  goals,
  goalJournalEntries,
  workoutSets,
  activities,
  events,
  dashboards,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type {
  MergeLogPayloadV1,
  MetricTypeMergePayloadV1,
  ActivityMergePayloadV1,
} from "./types";
import type * as schema from "@/db/schema";
import type { ExtractTablesWithRelations } from "drizzle-orm";

// PgQueryResultHKT is the base HKT that both postgres-js and pglite extend.
// Using it here lets this file be called from both production (postgres-js)
// and tests (pglite) without the HKT mismatch error.
type Tx = PgTransaction<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Reverse a metric_type merge inside an existing transaction. Caller
 * is responsible for the outer `db.transaction()` and for the CAS that
 * sets `merge_log.undone_at` (so concurrent double-undos can't both
 * proceed). This function is pure mutation: snapshot in, mutations out.
 *
 * Order matters:
 *   1. Re-INSERT the deleted metric_type row(s) with original ids
 *      (FK targets must exist before we re-point rows back).
 *   2. UPDATE FK rewires by row id (metrics, event_metrics, goals,
 *      journal entries, workout_sets).
 *   3. UN-rescale metrics + event_metrics values.
 *   4. Re-INSERT event_metrics rows that were dedupe-deleted.
 *   5. RECOMPUTE daily_summaries from `metrics` for both canonical_id
 *      and merged_id (no snapshot — post-merge ingest survives).
 *   6. DELETE the alias row (metric_type_aliases.alias = merged.row.name).
 *
 * Async — postgres-js transactions can't have sync callbacks, and
 * every drizzle query inside is awaited.
 */
export async function applyMetricTypeUndo(
  tx: Tx,
  payload: MetricTypeMergePayloadV1,
): Promise<void> {
  const canonicalId = payload.canonicalId;

  // 1. Re-INSERT each merged metric_type row with its original id.
  // Postgres identity columns reject explicit values by default; we
  // generate them with `BY DEFAULT` in the schema so a manual id is
  // accepted. After the inserts we reset the sequence's next value to
  // MAX(id)+1 so future auto-generated ids don't collide.
  for (const m of payload.merged) {
    await tx
      .insert(metricTypes)
      .values({
        id: m.row.id,
        name: m.row.name,
        unit: m.row.unit,
        activityId: m.row.activityId,
        frequencyHint: m.row.frequencyHint,
        target: m.row.target,
        higherIsBetter: m.row.higherIsBetter,
      })
      ;
  }

  // 2. Re-point FKs by id. Bulk update per merged entry.
  for (const m of payload.merged) {
    if (m.metricsMovedIds.length > 0) {
      await tx
        .update(metrics)
        .set({ metricTypeId: m.row.id })
        .where(inArray(metrics.id, m.metricsMovedIds));
      // 3a. Un-rescale metrics.value if scale != 1.
      if (m.scale !== 1) {
        await tx
          .update(metrics)
          .set({ value: sql`${metrics.value} / ${m.scale}` })
          .where(inArray(metrics.id, m.metricsMovedIds));
      }
    }

    // event_metrics rewires by event_id (composite logic). The merge
    // endpoint UPDATEd event_metrics SET metric_type_id = canonicalId
    // WHERE event_id IN (...) for surviving (non-deduped) rows. We
    // reverse by setting metric_type_id back, scoped to the same
    // event_ids we captured.
    if (m.eventMetricsMovedIds.length > 0) {
      await tx
        .update(eventMetrics)
        .set({ metricTypeId: m.row.id })
        .where(
          and(
            eq(eventMetrics.metricTypeId, canonicalId),
            inArray(eventMetrics.eventId, m.eventMetricsMovedIds),
          ),
        );
      // 3b. Un-rescale event_metrics.value if scale != 1.
      if (m.scale !== 1) {
        await tx
          .update(eventMetrics)
          .set({ value: sql`${eventMetrics.value} / ${m.scale}` })
          .where(
            and(
              eq(eventMetrics.metricTypeId, m.row.id),
              inArray(eventMetrics.eventId, m.eventMetricsMovedIds),
            ),
          );
      }
    }

    // 4. Re-INSERT dedupe-deleted event_metrics.
    for (const r of m.eventMetricsDeleted) {
      await tx.insert(eventMetrics).values({
        eventId: r.eventId,
        metricTypeId: r.metricTypeId,
        value: r.value,
      });
    }

    if (m.goalsMovedIds.length > 0) {
      await tx
        .update(goals)
        .set({ metricTypeId: m.row.id })
        .where(inArray(goals.id, m.goalsMovedIds));
    }

    if (m.journalEntriesMovedIds.length > 0) {
      await tx
        .update(goalJournalEntries)
        .set({ linkedMetricTypeId: m.row.id })
        .where(inArray(goalJournalEntries.id, m.journalEntriesMovedIds));
    }

    if (m.workoutSetsMovedIds.length > 0) {
      await tx
        .update(workoutSets)
        .set({ exerciseMetricTypeId: m.row.id })
        .where(inArray(workoutSets.id, m.workoutSetsMovedIds));
    }
  }

  // 4b. CHAIN UNWIND: move metrics on canonical that came in via the
  //     re-pointed aliases (or the new alias inserted by the merge,
  //     which equals merged.row.name) back to merged_id. Without this,
  //     a sequence of merge → ingest → merge → ingest → undo would
  //     strand the post-merge ingests on canonical because they were
  //     never in metricsMovedIds.
  for (const m of payload.merged) {
    const aliasKeys = [m.row.name, ...(m.aliasesRepointed ?? [])];
    if (aliasKeys.length === 0) continue;
    await tx
      .update(metrics)
      .set({ metricTypeId: m.row.id })
      .where(
        and(
          eq(metrics.metricTypeId, canonicalId),
          inArray(metrics.alias, aliasKeys),
        ),
      );
  }

  // 5. RECOMPUTE daily_summaries from current `metrics` for all touched
  // metric_type ids. Post-merge ingest survives because it's already in
  // `metrics`. We delete + re-aggregate so historical rows don't drift.
  const touchedIds = [canonicalId, ...payload.merged.map((m) => m.row.id)];
  await tx
    .delete(dailySummaries)
    .where(inArray(dailySummaries.metricTypeId, touchedIds));
  // Re-aggregate carrying user_id through (multi-user: each summary
  // row belongs to the metric_type's owner). Group by user_id too so
  // the (user_id, date, metric_type_id) unique index is honored.
  await tx.execute(sql`
    INSERT INTO daily_summaries (user_id, date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
    SELECT
      user_id,
      (recorded_at AT TIME ZONE 'UTC')::date AS date,
      metric_type_id,
      AVG(value),
      MIN(value),
      MAX(value),
      COUNT(*),
      MAX(recorded_at)
    FROM metrics
    WHERE metric_type_id IN (${sql.join(
      touchedIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    GROUP BY user_id, (recorded_at AT TIME ZONE 'UTC')::date, metric_type_id
  `);

  // 6. Re-point aliases first (so the row exists for any merged.name
  //    that ALSO happens to be in aliasesRepointed), then delete the
  //    alias inserted by the merge — but only if it wasn't a
  //    pre-existing one we just re-pointed back.
  for (const m of payload.merged) {
    const repointed = m.aliasesRepointed ?? [];
    if (repointed.length > 0) {
      await tx
        .update(metricTypeAliases)
        .set({ canonicalMetricTypeId: m.row.id })
        .where(inArray(metricTypeAliases.alias, repointed));
    }
    if (!repointed.includes(m.row.name)) {
      await tx
        .delete(metricTypeAliases)
        .where(eq(metricTypeAliases.alias, m.row.name));
    }
  }

  // After re-inserting metric_types rows with explicit ids, bump the
  // identity sequence past the highest id so the next INSERT without
  // an explicit id doesn't collide.
  await tx.execute(
    sql`SELECT setval(pg_get_serial_sequence('metric_types', 'id'), GREATEST((SELECT MAX(id) FROM metric_types), 1))`,
  );
}

/**
 * Reverse a activity merge.
 *
 * Order:
 *   1. Re-INSERT the deleted activities row(s) with original ids.
 *   2. UPDATE events.activity_id, goals.activity_id, metric_types.activity_id by id list.
 *   3. UPDATE dashboards.activity_id (dashboards were NULL'd via ON DELETE
 *      SET NULL when the activity was deleted).
 */
export async function applyActivityUndo(
  tx: Tx,
  payload: ActivityMergePayloadV1,
): Promise<void> {
  for (const m of payload.merged) {
    await tx
      .insert(activities)
      .values({ id: m.row.id, name: m.row.name, color: m.row.color })
      ;

    if (m.eventsMovedIds.length > 0) {
      await tx
        .update(events)
        .set({ activityId: m.row.id })
        .where(inArray(events.id, m.eventsMovedIds));
    }
    if (m.goalsMovedIds.length > 0) {
      await tx
        .update(goals)
        .set({ activityId: m.row.id })
        .where(inArray(goals.id, m.goalsMovedIds));
    }
    if (m.metricTypesMovedIds.length > 0) {
      await tx
        .update(metricTypes)
        .set({ activityId: m.row.id })
        .where(inArray(metricTypes.id, m.metricTypesMovedIds));
    }
    if (m.dashboardsNulledIds.length > 0) {
      await tx
        .update(dashboards)
        .set({ activityId: m.row.id })
        .where(inArray(dashboards.id, m.dashboardsNulledIds));
    }
  }

  // Bump identity sequence past any explicit ids we re-inserted.
  await tx.execute(
    sql`SELECT setval(pg_get_serial_sequence('activities', 'id'), GREATEST((SELECT MAX(id) FROM activities), 1))`,
  );
}

/** Discriminator dispatch. */
export async function applyMergeUndo(
  tx: Tx,
  payload: MergeLogPayloadV1,
): Promise<void> {
  if (payload.kind === "metric_type") {
    await applyMetricTypeUndo(tx, payload);
  } else {
    await applyActivityUndo(tx, payload);
  }
}
