/**
 * Versioned JSON shapes stored in `merge_log.payload`. Top-level `v: 1`
 * lets future schema changes branch on the version. Daily_summaries is
 * NOT in the snapshot — applier recomputes it from `metrics` on undo so
 * post-merge ingest survives.
 */

export const MERGE_LOG_PAYLOAD_VERSION = 1 as const;

/** Snapshot of one merge_types row that was deleted by the merge. */
export interface MetricTypeRowSnapshot {
  id: number;
  name: string;
  unit: string;
  activityId: number | null;
  frequencyHint: "daily" | "weekly" | "occasional";
  target: number | null;
  higherIsBetter: boolean;
}

/** Snapshot of one event_metrics row that was deleted by the merge's
 * dedupe step. Re-INSERTed on undo. */
export interface EventMetricRowSnapshot {
  eventId: number;
  metricTypeId: number;
  value: number;
}

/** Per-mergedId payload entry inside a metric_type merge. */
export interface MetricTypeMergedEntry {
  /** Original metric_types row, restored verbatim on undo. */
  row: MetricTypeRowSnapshot;
  /** Rescale factor applied to metrics.value + event_metrics.value. 1 if
   * no rescale; >0 always. Undo divides by this. */
  scale: number;
  /** metrics row ids that got re-pointed from merged → canonical.
   * Undo re-points them back. */
  metricsMovedIds: number[];
  /** event_metrics rows that survived the dedupe step (re-pointed,
   * possibly rescaled). Stored as ids; undo re-points + un-rescales. */
  eventMetricsMovedIds: number[];
  /** event_metrics rows DELETED by the dedupe step (because the
   * canonical already had a row for the same event). Snapshot lets undo
   * re-INSERT them. */
  eventMetricsDeleted: EventMetricRowSnapshot[];
  /** goals.metric_type_id rewires. */
  goalsMovedIds: number[];
  /** goal_journal_entries.linked_metric_type_id rewires. */
  journalEntriesMovedIds: number[];
  /** workout_sets.exercise_metric_type_id rewires. */
  workoutSetsMovedIds: number[];
  /** Aliases that previously pointed at the merged metric_type and got
   * re-pointed to canonical so chain-merges don't lose them to the FK
   * CASCADE DELETE. Undo points them back at the (re-inserted) merged
   * row. Optional for backward-compat with v1 payloads written before
   * this field existed; absent = empty list. */
  aliasesRepointed?: string[];
}

export interface MetricTypeMergePayloadV1 {
  v: typeof MERGE_LOG_PAYLOAD_VERSION;
  kind: "metric_type";
  canonicalId: number;
  merged: MetricTypeMergedEntry[];
}

export interface ActivityRowSnapshot {
  id: number;
  name: string;
  color: string;
}

export interface ActivityMergedEntry {
  /** Original activities row, restored verbatim on undo. */
  row: ActivityRowSnapshot;
  /** events.activity_id rewires. */
  eventsMovedIds: number[];
  /** goals.activity_id rewires. */
  goalsMovedIds: number[];
  /** metric_types.activity_id rewires. */
  metricTypesMovedIds: number[];
  /** dashboards whose activity_id matched the merged activity — they got
   * NULL'd via ON DELETE SET NULL when the activity was deleted. Undo sets
   * them back to the merged activity's id (the row is restored first). */
  dashboardsNulledIds: number[];
}

export interface ActivityMergePayloadV1 {
  v: typeof MERGE_LOG_PAYLOAD_VERSION;
  kind: "activity";
  canonicalId: number;
  merged: ActivityMergedEntry[];
}

export type MergeLogPayloadV1 = MetricTypeMergePayloadV1 | ActivityMergePayloadV1;
