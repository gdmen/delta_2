import {
  metricTypes,
  metricTypeAliases,
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
import { PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import {
  MERGE_LOG_PAYLOAD_VERSION,
  type MetricTypeMergedEntry,
  type SportMergedEntry,
} from "./types";
import type * as schema from "@/db/schema";

/**
 * Pure functions that read pre-mutation state for one mergedId and
 * return a JSON-serializable snapshot. Callers use these INSIDE the
 * merge transaction, just BEFORE each mergedId's mutations — so for
 * multi-row merges (A→C and B→C in one call) B's snapshot reflects
 * the post-A state.
 *
 * `tx` is the postgres-js drizzle transaction object. All queries are
 * awaited (the better-sqlite3 sync `.all()` style is gone).
 */

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
 * Captures everything needed to undo a single (canonicalId, mergedId)
 * inside a metric_type merge call. Run BEFORE the mutations for THIS
 * mergedId. Reads:
 *   - the merged metric_type row (about to be deleted)
 *   - metrics row ids (about to be re-pointed; rescale recorded too)
 *   - event_metrics row ids that will be re-pointed
 *   - event_metrics rows that will be DELETED by the dedupe step
 *   - goal / goal_journal_entries / workout_set ids that will be re-pointed
 */
export async function buildMetricTypeMergedEntry(
  tx: Tx,
  canonicalId: number,
  mergedId: number,
  scale: number,
): Promise<MetricTypeMergedEntry> {
  // Row about to be deleted.
  const rowResult = await tx
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
    .where(eq(metricTypes.id, mergedId));
  if (rowResult.length === 0) {
    throw new Error(`buildMetricTypeMergedEntry: merged metric_type id=${mergedId} not found`);
  }
  const row = rowResult[0];

  const metricsMovedIds = (
    await tx
      .select({ id: metrics.id })
      .from(metrics)
      .where(eq(metrics.metricTypeId, mergedId))
  ).map((r) => r.id);

  // event_metrics about to be DELETED by the dedupe step (canonical
  // already has a row for the same event_id).
  const canonicalEventIds = (
    await tx
      .select({ eid: eventMetrics.eventId })
      .from(eventMetrics)
      .where(eq(eventMetrics.metricTypeId, canonicalId))
  ).map((r) => r.eid);

  const eventMetricsDeleted =
    canonicalEventIds.length === 0
      ? []
      : await tx
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
          );

  // event_metrics that will SURVIVE the dedupe (their event_id isn't
  // in canonicalEventIds). These get re-pointed to canonical and
  // possibly rescaled.
  const eventMetricsMovedIds =
    canonicalEventIds.length === 0
      ? (
          await tx
            .select({ id: eventMetrics.eventId })
            .from(eventMetrics)
            .where(eq(eventMetrics.metricTypeId, mergedId))
        ).map((r) => r.id)
      : (
          await tx
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
        ).map((r) => r.id);

  const goalsMovedIds = (
    await tx
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.metricTypeId, mergedId))
  ).map((r) => r.id);

  const journalEntriesMovedIds = (
    await tx
      .select({ id: goalJournalEntries.id })
      .from(goalJournalEntries)
      .where(eq(goalJournalEntries.linkedMetricTypeId, mergedId))
  ).map((r) => r.id);

  const workoutSetsMovedIds = (
    await tx
      .select({ id: workoutSets.id })
      .from(workoutSets)
      .where(eq(workoutSets.exerciseMetricTypeId, mergedId))
  ).map((r) => r.id);

  // Aliases currently pointing at the merged type. The merge re-points
  // them to canonical (instead of letting the FK cascade-delete them),
  // so chain-merges keep all source-prefixed names routed to the final
  // canonical.
  const aliasesRepointed = (
    await tx
      .select({ alias: metricTypeAliases.alias })
      .from(metricTypeAliases)
      .where(eq(metricTypeAliases.canonicalMetricTypeId, mergedId))
  ).map((r) => r.alias);

  return {
    row,
    scale,
    metricsMovedIds,
    eventMetricsMovedIds,
    eventMetricsDeleted,
    goalsMovedIds,
    journalEntriesMovedIds,
    workoutSetsMovedIds,
    aliasesRepointed,
  };
}

/**
 * Same shape for sport merges. Critical: the dashboards snapshot MUST
 * happen BEFORE `tx.delete(sports)` — once the sport row is deleted,
 * ON DELETE SET NULL on dashboards.sport_id has already nulled the
 * column, so a post-delete snapshot would always be empty.
 */
export async function buildSportMergedEntry(
  tx: Tx,
  mergedId: number,
): Promise<SportMergedEntry> {
  const rowResult = await tx
    .select({ id: sports.id, name: sports.name, color: sports.color })
    .from(sports)
    .where(eq(sports.id, mergedId));
  if (rowResult.length === 0) {
    throw new Error(`buildSportMergedEntry: merged sport id=${mergedId} not found`);
  }
  const row = rowResult[0];

  const eventsMovedIds = (
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.sportId, mergedId))
  ).map((r) => r.id);

  const goalsMovedIds = (
    await tx
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.sportId, mergedId))
  ).map((r) => r.id);

  const metricTypesMovedIds = (
    await tx
      .select({ id: metricTypes.id })
      .from(metricTypes)
      .where(eq(metricTypes.sportId, mergedId))
  ).map((r) => r.id);

  // Captured BEFORE the sport delete (caller must respect ordering).
  const dashboardsNulledIds = (
    await tx
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(eq(dashboards.sportId, mergedId))
  ).map((r) => r.id);

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
