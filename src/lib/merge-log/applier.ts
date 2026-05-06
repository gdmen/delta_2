import {
  metricTypes,
  metricTypeAliases,
  metrics,
  eventMetrics,
  dailySummaries,
  goals,
  goalJournalEntries,
  workoutSets,
  sports,
  events,
  dashboards,
} from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import type {
  MergeLogPayloadV1,
  MetricTypeMergePayloadV1,
  SportMergePayloadV1,
} from "./types";
import type { db as Db } from "@/db";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

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
 */
export function applyMetricTypeUndo(tx: Tx, payload: MetricTypeMergePayloadV1): void {
  const canonicalId = payload.canonicalId;

  // 1. Re-INSERT each merged metric_type row with its original id.
  for (const m of payload.merged) {
    tx.insert(metricTypes)
      .values({
        id: m.row.id,
        name: m.row.name,
        unit: m.row.unit,
        sportId: m.row.sportId,
        frequencyHint: m.row.frequencyHint,
        target: m.row.target,
        higherIsBetter: m.row.higherIsBetter,
      })
      .run();
  }

  // 2. Re-point FKs by id. Bulk update per merged entry.
  for (const m of payload.merged) {
    if (m.metricsMovedIds.length > 0) {
      tx.update(metrics)
        .set({ metricTypeId: m.row.id })
        .where(inArray(metrics.id, m.metricsMovedIds))
        .run();
      // 3a. Un-rescale metrics.value if scale != 1.
      if (m.scale !== 1) {
        tx.update(metrics)
          .set({ value: sql`${metrics.value} / ${m.scale}` })
          .where(inArray(metrics.id, m.metricsMovedIds))
          .run();
      }
    }

    // event_metrics rewires by event_id (composite logic). The merge
    // endpoint UPDATEd event_metrics SET metric_type_id = canonicalId
    // WHERE event_id IN (...) for surviving (non-deduped) rows. We
    // reverse by setting metric_type_id back, scoped to the same
    // event_ids we captured.
    if (m.eventMetricsMovedIds.length > 0) {
      tx.update(eventMetrics)
        .set({ metricTypeId: m.row.id })
        .where(
          sql`${eventMetrics.metricTypeId} = ${canonicalId} AND ${eventMetrics.eventId} IN (${sql.join(
            m.eventMetricsMovedIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .run();
      // 3b. Un-rescale event_metrics.value if scale != 1.
      if (m.scale !== 1) {
        tx.update(eventMetrics)
          .set({ value: sql`${eventMetrics.value} / ${m.scale}` })
          .where(
            sql`${eventMetrics.metricTypeId} = ${m.row.id} AND ${eventMetrics.eventId} IN (${sql.join(
              m.eventMetricsMovedIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
          .run();
      }
    }

    // 4. Re-INSERT dedupe-deleted event_metrics.
    for (const r of m.eventMetricsDeleted) {
      tx.insert(eventMetrics)
        .values({
          eventId: r.eventId,
          metricTypeId: r.metricTypeId,
          value: r.value,
        })
        .run();
    }

    if (m.goalsMovedIds.length > 0) {
      tx.update(goals)
        .set({ metricTypeId: m.row.id })
        .where(inArray(goals.id, m.goalsMovedIds))
        .run();
    }

    if (m.journalEntriesMovedIds.length > 0) {
      tx.update(goalJournalEntries)
        .set({ linkedMetricTypeId: m.row.id })
        .where(inArray(goalJournalEntries.id, m.journalEntriesMovedIds))
        .run();
    }

    if (m.workoutSetsMovedIds.length > 0) {
      tx.update(workoutSets)
        .set({ exerciseMetricTypeId: m.row.id })
        .where(inArray(workoutSets.id, m.workoutSetsMovedIds))
        .run();
    }
  }

  // 5. RECOMPUTE daily_summaries from current `metrics` for all touched
  // metric_type ids. Post-merge ingest survives because it's already in
  // `metrics`. We delete + re-aggregate so historical rows don't drift.
  const touchedIds = [canonicalId, ...payload.merged.map((m) => m.row.id)];
  tx.delete(dailySummaries)
    .where(inArray(dailySummaries.metricTypeId, touchedIds))
    .run();
  // Aggregate from metrics. recordedAt is an ISO timestamp; date is the
  // YYYY-MM-DD prefix. last_ingest_at is the max recordedAt per group.
  tx.run(sql`
    INSERT INTO daily_summaries (date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
    SELECT
      substr(recorded_at, 1, 10) AS date,
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
    GROUP BY substr(recorded_at, 1, 10), metric_type_id
  `);

  // 6. Delete each alias inserted by the merge, then re-point aliases
  //    that were re-pointed from merged → canonical back to merged.
  //    Order matters: if `merged.row.name` happens to coincide with one
  //    of the re-pointed aliases (i.e., merged.row.name was already an
  //    alias before this merge), we want the re-point to win — delete
  //    first, then UPDATE recreates the row keyed by alias.
  for (const m of payload.merged) {
    tx.delete(metricTypeAliases)
      .where(eq(metricTypeAliases.alias, m.row.name))
      .run();
    const repointed = m.aliasesRepointed ?? [];
    if (repointed.length > 0) {
      tx.update(metricTypeAliases)
        .set({ canonicalMetricTypeId: m.row.id })
        .where(inArray(metricTypeAliases.alias, repointed))
        .run();
    }
  }
}

/**
 * Reverse a sport merge.
 *
 * Order:
 *   1. Re-INSERT the deleted sports row(s) with original ids.
 *   2. UPDATE events.sport_id, goals.sport_id, metric_types.sport_id by id list.
 *   3. UPDATE dashboards.sport_id (dashboards were NULL'd via ON DELETE
 *      SET NULL when the sport was deleted).
 */
export function applySportUndo(tx: Tx, payload: SportMergePayloadV1): void {
  for (const m of payload.merged) {
    tx.insert(sports)
      .values({ id: m.row.id, name: m.row.name, color: m.row.color })
      .run();

    if (m.eventsMovedIds.length > 0) {
      tx.update(events)
        .set({ sportId: m.row.id })
        .where(inArray(events.id, m.eventsMovedIds))
        .run();
    }
    if (m.goalsMovedIds.length > 0) {
      tx.update(goals)
        .set({ sportId: m.row.id })
        .where(inArray(goals.id, m.goalsMovedIds))
        .run();
    }
    if (m.metricTypesMovedIds.length > 0) {
      tx.update(metricTypes)
        .set({ sportId: m.row.id })
        .where(inArray(metricTypes.id, m.metricTypesMovedIds))
        .run();
    }
    if (m.dashboardsNulledIds.length > 0) {
      tx.update(dashboards)
        .set({ sportId: m.row.id })
        .where(inArray(dashboards.id, m.dashboardsNulledIds))
        .run();
    }
  }
}

/** Discriminator dispatch. */
export function applyMergeUndo(tx: Tx, payload: MergeLogPayloadV1): void {
  if (payload.kind === "metric_type") {
    applyMetricTypeUndo(tx, payload);
  } else {
    applySportUndo(tx, payload);
  }
}
