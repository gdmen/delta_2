import {
  metricTypes,
  metrics,
  eventMetrics,
  goals,
  goalJournalEntries,
  workoutSets,
  sports,
  events,
  dashboards,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  MERGE_LOG_PAYLOAD_VERSION,
  type MetricTypeMergedEntry,
  type SportMergedEntry,
} from "./types";

/**
 * Pure functions that read pre-mutation state for one mergedId and
 * return a JSON-serializable snapshot. Callers use these INSIDE the
 * merge transaction, just BEFORE each mergedId's mutations — so for
 * multi-row merges (A→C and B→C in one call) B's snapshot reflects
 * the post-A state.
 *
 * `tx` is whatever the better-sqlite3-Drizzle transaction callback
 * passes through; we don't import a concrete type because the
 * transaction signature isn't exported by drizzle-orm's sqlite-core
 * surface. Use `typeof db` from caller context.
 */

import type { db as Db } from "@/db";

// Drizzle's transaction callback hands us a tx object with the same
// query-builder shape as the top-level db. Extract the parameter type
// so we don't have to redeclare the surface area.
type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

/**
 * Captures everything needed to undo a single (canonicalId, mergedId)
 * inside a metric_type merge call. Run BEFORE the mutations for THIS
 * mergedId. Reads:
 *   - the merged metric_type row (about to be deleted)
 *   - metrics row ids (about to be re-pointed; rescale recorded too)
 *   - event_metrics row ids that will be re-pointed
 *   - event_metrics rows that will be DELETED by the dedupe step
 *   - goal / goal_journal_entries / workout_set ids that will be re-pointed
 */
export function buildMetricTypeMergedEntry(
  tx: Tx,
  canonicalId: number,
  mergedId: number,
  scale: number,
): MetricTypeMergedEntry {
  // Row about to be deleted.
  const rowResult = tx
    .select({
      id: metricTypes.id,
      name: metricTypes.name,
      unit: metricTypes.unit,
      sportId: metricTypes.sportId,
      frequencyHint: metricTypes.frequencyHint,
      target: metricTypes.target,
      higherIsBetter: metricTypes.higherIsBetter,
    })
    .from(metricTypes)
    .where(eq(metricTypes.id, mergedId))
    .all();
  if (rowResult.length === 0) {
    throw new Error(`buildMetricTypeMergedEntry: merged metric_type id=${mergedId} not found`);
  }
  const row = rowResult[0];

  const metricsMovedIds = tx
    .select({ id: metrics.id })
    .from(metrics)
    .where(eq(metrics.metricTypeId, mergedId))
    .all()
    .map((r) => r.id);

  // event_metrics about to be DELETED by the dedupe step (canonical
  // already has a row for the same event_id).
  const canonicalEventIds = tx
    .select({ eid: eventMetrics.eventId })
    .from(eventMetrics)
    .where(eq(eventMetrics.metricTypeId, canonicalId))
    .all()
    .map((r) => r.eid);

  const eventMetricsDeleted =
    canonicalEventIds.length === 0
      ? []
      : tx
          .select({
            eventId: eventMetrics.eventId,
            metricTypeId: eventMetrics.metricTypeId,
            value: eventMetrics.value,
          })
          .from(eventMetrics)
          .where(
            and(
              eq(eventMetrics.metricTypeId, mergedId),
              inArray(eventMetrics.eventId, canonicalEventIds),
            ),
          )
          .all();

  // event_metrics that will SURVIVE the dedupe (their event_id isn't
  // in canonicalEventIds). These get re-pointed to canonical and
  // possibly rescaled.
  const eventMetricsMovedIds =
    canonicalEventIds.length === 0
      ? tx
          .select({ id: eventMetrics.eventId })
          .from(eventMetrics)
          .where(eq(eventMetrics.metricTypeId, mergedId))
          .all()
          .map((r) => r.id)
      : tx
          .select({ id: eventMetrics.eventId })
          .from(eventMetrics)
          .where(
            and(
              eq(eventMetrics.metricTypeId, mergedId),
              sql`${eventMetrics.eventId} NOT IN (${sql.join(
                canonicalEventIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            ),
          )
          .all()
          .map((r) => r.id);

  const goalsMovedIds = tx
    .select({ id: goals.id })
    .from(goals)
    .where(eq(goals.metricTypeId, mergedId))
    .all()
    .map((r) => r.id);

  const journalEntriesMovedIds = tx
    .select({ id: goalJournalEntries.id })
    .from(goalJournalEntries)
    .where(eq(goalJournalEntries.linkedMetricTypeId, mergedId))
    .all()
    .map((r) => r.id);

  const workoutSetsMovedIds = tx
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .where(eq(workoutSets.exerciseMetricTypeId, mergedId))
    .all()
    .map((r) => r.id);

  return {
    row,
    scale,
    metricsMovedIds,
    eventMetricsMovedIds,
    eventMetricsDeleted,
    goalsMovedIds,
    journalEntriesMovedIds,
    workoutSetsMovedIds,
  };
}

/**
 * Same shape for sport merges. Critical: the dashboards snapshot MUST
 * happen BEFORE `tx.delete(sports)` — once the sport row is deleted,
 * ON DELETE SET NULL on dashboards.sport_id has already nulled the
 * column, so a post-delete snapshot would always be empty.
 */
export function buildSportMergedEntry(tx: Tx, mergedId: number): SportMergedEntry {
  const rowResult = tx
    .select({ id: sports.id, name: sports.name, color: sports.color })
    .from(sports)
    .where(eq(sports.id, mergedId))
    .all();
  if (rowResult.length === 0) {
    throw new Error(`buildSportMergedEntry: merged sport id=${mergedId} not found`);
  }
  const row = rowResult[0];

  const eventsMovedIds = tx
    .select({ id: events.id })
    .from(events)
    .where(eq(events.sportId, mergedId))
    .all()
    .map((r) => r.id);

  const goalsMovedIds = tx
    .select({ id: goals.id })
    .from(goals)
    .where(eq(goals.sportId, mergedId))
    .all()
    .map((r) => r.id);

  const metricTypesMovedIds = tx
    .select({ id: metricTypes.id })
    .from(metricTypes)
    .where(eq(metricTypes.sportId, mergedId))
    .all()
    .map((r) => r.id);

  // Captured BEFORE the sport delete (caller must respect ordering).
  const dashboardsNulledIds = tx
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(eq(dashboards.sportId, mergedId))
    .all()
    .map((r) => r.id);

  return {
    row,
    eventsMovedIds,
    goalsMovedIds,
    metricTypesMovedIds,
    dashboardsNulledIds,
  };
}

/** Rebuild a top-level metric-type merge payload from accumulated entries. */
export function buildMetricTypeMergePayload(
  canonicalId: number,
  merged: MetricTypeMergedEntry[],
): import("./types").MetricTypeMergePayloadV1 {
  return { v: MERGE_LOG_PAYLOAD_VERSION, kind: "metric_type", canonicalId, merged };
}

export function buildSportMergePayload(
  canonicalId: number,
  merged: SportMergedEntry[],
): import("./types").SportMergePayloadV1 {
  return { v: MERGE_LOG_PAYLOAD_VERSION, kind: "sport", canonicalId, merged };
}
