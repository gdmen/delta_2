import { db } from "@/db";
import { metrics, events, workoutSets, eventMetrics } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { AnyPgDb } from "@/db/types";

/**
 * Type alias for the drizzle handle. Tests pass an in-process pglite
 * instance via the optional last arg; production calls fall through to
 * the shared `db` (postgres-js) import. `AnyPgDb` widens to accept both
 * drivers since they share the same `PgDatabase` base class.
 */
type DbLike = AnyPgDb;

export interface IngestResult {
  accepted: number;
  skipped: number;
  errors: string[];
}

export interface MetricInput {
  /** Per-user scoping. Inserted on the row and used to scope dedupe / summary writes. */
  userId: number;
  metricTypeId: number;
  value: number;
  recordedAt: string;
  source: string;
  sourceId?: string | null;
  /** Resolution alias key (e.g. "fitnotes_bt:weight"). REQUIRED for
   * chain-undo coverage; pass the value the resolver returned, or
   * null for manual entries that bypassed the resolver. */
  alias: string | null;
}

export interface EventInput {
  /** Per-user scoping. Inserted on the row and used to scope dedupe. */
  userId: number;
  sportId: number;
  type: string;
  durationMinutes?: number | null;
  notes?: string | null;
  startedAt: string;
  source: string;
  sourceId?: string | null;
}

export interface WorkoutSetInput {
  exerciseMetricTypeId: number;
  setNumber: number;
  reps: number;
  weight: number;
  rpe?: number | null;
  notes?: string | null;
}

export async function upsertMetric(
  input: MetricInput,
  conn: DbLike = db,
): Promise<"accepted" | "skipped"> {
  // Shadow `db` inside this function so all the existing query-builder
  // calls flow through the (potentially overridden) `conn`.
  const db = conn;
  if (input.sourceId) {
    const existing = await db
      .select({
        id: metrics.id,
        recordedAt: metrics.recordedAt,
        metricTypeId: metrics.metricTypeId,
      })
      .from(metrics)
      .where(and(eq(metrics.userId, input.userId), eq(metrics.sourceId, input.sourceId)))
      .limit(1);

    if (existing.length > 0) {
      await db.update(metrics)
        .set({ value: input.value, recordedAt: input.recordedAt, alias: input.alias })
        .where(and(eq(metrics.userId, input.userId), eq(metrics.sourceId, input.sourceId)));

      // Recompute the new cell. If the source revised the timestamp into
      // a different calendar day, the old day's cell needs a recompute
      // too (its rows shifted out).
      await recomputeDailySummary(input.userId, input.metricTypeId, input.recordedAt, db);
      if (existing[0].recordedAt.slice(0, 10) !== input.recordedAt.slice(0, 10)) {
        await recomputeDailySummary(input.userId, existing[0].metricTypeId, existing[0].recordedAt, db);
      }
      return "skipped";
    }
  }

  await db.insert(metrics).values({
    userId: input.userId,
    metricTypeId: input.metricTypeId,
    value: input.value,
    recordedAt: input.recordedAt,
    source: input.source,
    sourceId: input.sourceId,
    alias: input.alias,
  });

  await recomputeDailySummary(input.userId, input.metricTypeId, input.recordedAt, db);
  return "accepted";
}

/**
 * Look up an existing event by source_id first, then fall back to the
 * (started_at, sport_id, type) natural key. Used by CSV importers that
 * attach child rows (event_metrics, workout_sets) to parent events —
 * source_id wins when present, natural key handles manual rows.
 */
export async function resolveEventId(input: {
  userId: number;
  sourceId: string;
  startedAt: string;
  sportId: number;
  type: string;
}): Promise<number | null> {
  if (input.sourceId) {
    const bySourceId = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.userId, input.userId), eq(events.sourceId, input.sourceId)))
      .limit(1);
    if (bySourceId[0]) return bySourceId[0].id;
  }
  const byNatural = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.userId, input.userId),
        eq(events.startedAt, input.startedAt),
        eq(events.sportId, input.sportId),
        eq(events.type, input.type),
      ),
    )
    .limit(1);
  return byNatural[0]?.id ?? null;
}

export async function upsertEvent(input: EventInput): Promise<{ status: "accepted" | "skipped"; eventId: number }> {
  if (input.sourceId) {
    const existing = await db.select({ id: events.id })
      .from(events)
      .where(and(eq(events.userId, input.userId), eq(events.sourceId, input.sourceId)))
      .limit(1);

    if (existing.length > 0) {
      return { status: "skipped", eventId: existing[0].id };
    }
  }

  const result = await db.insert(events).values({
    userId: input.userId,
    sportId: input.sportId,
    type: input.type,
    durationMinutes: input.durationMinutes,
    notes: input.notes,
    startedAt: input.startedAt,
    source: input.source,
    sourceId: input.sourceId,
  }).returning({ id: events.id });

  return { status: "accepted", eventId: result[0].id };
}

export async function insertWorkoutSets(eventId: number, sets: WorkoutSetInput[]): Promise<number> {
  if (sets.length === 0) return 0;

  const rows = sets.map((s) => ({
    eventId,
    exerciseMetricTypeId: s.exerciseMetricTypeId,
    setNumber: s.setNumber,
    reps: s.reps,
    weight: s.weight,
    rpe: s.rpe,
    notes: s.notes,
  }));

  await db.insert(workoutSets).values(rows);
  return rows.length;
}

/**
 * Upsert a single per-event metric (distance, calories, avg HR, etc.) keyed
 * by (eventId, metricTypeId). Re-importing the same event rewrites the
 * value rather than appending a duplicate row.
 *
 * eventId is the parent (already scoped to a user); event_metrics is an
 * INHERIT table with no user_id column of its own.
 */
export async function upsertEventMetric(
  eventId: number,
  metricTypeId: number,
  value: number
): Promise<"accepted" | "updated"> {
  const existing = await db
    .select({ eventId: eventMetrics.eventId })
    .from(eventMetrics)
    .where(
      and(eq(eventMetrics.eventId, eventId), eq(eventMetrics.metricTypeId, metricTypeId))
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(eventMetrics)
      .set({ value })
      .where(
        and(eq(eventMetrics.eventId, eventId), eq(eventMetrics.metricTypeId, metricTypeId))
      );
    return "updated";
  }

  await db.insert(eventMetrics).values({ eventId, metricTypeId, value });
  return "accepted";
}

/**
 * Upsert a single workout set by (eventId, exerciseMetricTypeId, setNumber).
 * Used by the CSV importer so re-importing the same file doesn't duplicate
 * rows. There's no unique index on that tuple, so we look up first and
 * update-or-insert application-side.
 *
 * eventId is the parent (already scoped to a user); workout_sets is an
 * INHERIT table with no user_id column.
 */
export async function upsertWorkoutSet(
  eventId: number,
  input: WorkoutSetInput
): Promise<"accepted" | "updated"> {
  const existing = await db
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.eventId, eventId),
        eq(workoutSets.exerciseMetricTypeId, input.exerciseMetricTypeId),
        eq(workoutSets.setNumber, input.setNumber)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(workoutSets)
      .set({
        reps: input.reps,
        weight: input.weight,
        rpe: input.rpe,
        notes: input.notes,
      })
      .where(eq(workoutSets.id, existing[0].id));
    return "updated";
  }

  await db.insert(workoutSets).values({
    eventId,
    exerciseMetricTypeId: input.exerciseMetricTypeId,
    setNumber: input.setNumber,
    reps: input.reps,
    weight: input.weight,
    rpe: input.rpe,
    notes: input.notes,
  });
  return "accepted";
}

export async function batchUpsertMetrics(inputs: MetricInput[]): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, skipped: 0, errors: [] };

  for (const input of inputs) {
    try {
      const status = await upsertMetric(input);
      if (status === "accepted") result.accepted++;
      else result.skipped++;
    } catch (err) {
      result.errors.push(`Failed metric ${input.metricTypeId} at ${input.recordedAt}: ${err}`);
    }
  }

  return result;
}

/**
 * Recompute the `daily_summaries` cell for one (user, metric_type, date)
 * tuple from the underlying `metrics` rows. Called after every metric
 * insert/update/delete so the cache stays consistent.
 *
 * Two-step:
 *  1. INSERT…SELECT GROUP BY → ON CONFLICT DO UPDATE. Fills in the
 *     correct avg/min/max/count/last_ingest_at when the cell has rows.
 *  2. DELETE if the cell ended up with zero rows (last entry deleted).
 *     The INSERT branch returns no rows in that case so the existing
 *     cached row would otherwise linger with stale values.
 */
export async function recomputeDailySummary(
  userId: number,
  metricTypeId: number,
  recordedAt: string,
  conn: DbLike = db,
) {
  const db = conn;
  const date = recordedAt.slice(0, 10);

  await db.execute(sql`
    INSERT INTO daily_summaries (user_id, date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
    SELECT
      user_id,
      substr(recorded_at, 1, 10) AS date,
      metric_type_id,
      AVG(value),
      MIN(value),
      MAX(value),
      COUNT(*)::int,
      MAX(recorded_at)
    FROM metrics
    WHERE user_id = ${userId}
      AND metric_type_id = ${metricTypeId}
      AND substr(recorded_at, 1, 10) = ${date}
    GROUP BY user_id, substr(recorded_at, 1, 10), metric_type_id
    ON CONFLICT (user_id, date, metric_type_id)
    DO UPDATE SET
      avg_value = excluded.avg_value,
      min_value = excluded.min_value,
      max_value = excluded.max_value,
      count = excluded.count,
      last_ingest_at = excluded.last_ingest_at;
  `);

  // Sweep the cell if the last row for it was just deleted. Cheap —
  // bounded by the unique index, runs only when the INSERT branch
  // produced no rows.
  await db.execute(sql`
    DELETE FROM daily_summaries
    WHERE user_id = ${userId}
      AND metric_type_id = ${metricTypeId}
      AND date = ${date}
      AND NOT EXISTS (
        SELECT 1 FROM metrics
        WHERE user_id = ${userId}
          AND metric_type_id = ${metricTypeId}
          AND substr(recorded_at, 1, 10) = ${date}
      );
  `);
}
