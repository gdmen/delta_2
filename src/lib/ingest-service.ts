import { db } from "@/db";
import { metrics, events, workoutSets, eventMetrics } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { AnyPgDb } from "@/db/types";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request bulk-import deferral context.
 *
 * Live ingest writes one metric at a time and recomputes its daily
 * summary cell immediately — that keeps widgets consistent in real
 * time and costs ~1 cheap GROUP BY scan. The bulk import path
 * (/api/import) feeds tens of thousands of rows through the same
 * `upsertMetric`, where the per-row recompute scans the same daily
 * bucket dozens of times. Result: the metrics phase becomes
 * O(rows × avg_bucket_size) and dominates total import time.
 *
 * Solution: when the importer wraps a section in `bulkImportStorage.run`,
 * `upsertMetric` collects touched (metricTypeId, date) tuples instead
 * of recomputing per-row. The importer then flushes one recompute per
 * touched bucket after the row loop completes. Same final state, ~100×
 * less GROUP BY work on large imports.
 *
 * External callers (single-row /api/metrics POST, bodyspec save,
 * Strava ingest) never wrap, so they keep their immediate-recompute
 * behavior. The wrap is opt-in per request via AsyncLocalStorage.
 */
export interface BulkImportContext {
  /** "metricTypeId|YYYY-MM-DD" → buckets touched during this import. */
  touchedBuckets: Set<string>;
}

export const bulkImportStorage = new AsyncLocalStorage<BulkImportContext>();

/**
 * Either record the touched bucket for a later batched recompute (when
 * inside a bulk-import context) or recompute immediately. Internal to
 * upsertMetric and the small set of other writes that update summary
 * cells.
 */
async function recomputeOrDefer(
  userId: number,
  metricTypeId: number,
  recordedAt: string,
  conn: DbLike,
): Promise<void> {
  const ctx = bulkImportStorage.getStore();
  if (ctx) {
    ctx.touchedBuckets.add(`${metricTypeId}|${recordedAt.slice(0, 10)}`);
    return;
  }
  await recomputeDailySummary(userId, metricTypeId, recordedAt, conn);
}

/**
 * Flush touched (metricTypeId, date) buckets to their summary cells.
 * Called once by the bulk importer after its row loop.
 *
 * Crucial perf: this CANNOT be a sequential per-bucket loop. Real-world
 * imports have tens of metric_types × ~365 days = thousands of distinct
 * buckets. A sequential `recomputeDailySummary` per bucket = thousands
 * of roundtrips that freeze the UI for tens of seconds with no SSE
 * progress between rows and phase-done.
 *
 * Instead: send the (id, date) tuples as parallel arrays via UNNEST and
 * let Postgres do all the GROUP BYs and ON CONFLICTs in one query.
 * Chunked at 1000 tuples to stay well below the Postgres parameter
 * ceiling. ~2 roundtrips per chunk regardless of bucket density.
 */
export async function flushBulkImportRecomputes(
  userId: number,
  ctx: BulkImportContext,
  conn: DbLike = db,
): Promise<void> {
  if (ctx.touchedBuckets.size === 0) return;

  // Parse "metricTypeId|date" keys into tuples.
  const tuples: Array<[number, string]> = [];
  for (const key of ctx.touchedBuckets) {
    const [idStr, date] = key.split("|");
    tuples.push([Number(idStr), date]);
  }

  // Chunk so we stay well under Postgres' parameter ceiling. 2 params
  // per tuple → 2000 params per chunk leaves a huge margin.
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < tuples.length; i += CHUNK_SIZE) {
    const chunk = tuples.slice(i, i + CHUNK_SIZE);
    // Cast the first tuple's columns so Postgres infers the right
    // types for the virtual `t(mid, d)` columns. Without the casts,
    // they default to `unknown` and the JOIN comparison fails with
    // "No operator matches the given name and argument types".
    // t.d is text (YYYY-MM-DD); we cast to date for ds.date equality
    // and concat-then-cast-to-timestamptz with explicit UTC offset for
    // metrics.recorded_at range bounds. A bare `t.d::timestamptz`
    // would use the session TimeZone, not UTC.
    const valuesList = sql.join(
      chunk.map(([id, d], idx) =>
        idx === 0
          ? sql`(${id}::int, ${d}::text)`
          : sql`(${id}, ${d})`,
      ),
      sql`, `,
    );

    // Upsert summary cells for every (metric_type_id, date) tuple in
    // this chunk, in one INSERT...SELECT GROUP BY. The VALUES list
    // pairs the (id, date) tuples element-wise as a virtual table.
    //
    // Half-open range on recorded_at preserves the
    // `idx_metrics_type_recorded` index — a `(recorded_at::date = t.d)`
    // predicate would force a per-row cast and lose the index.
    await conn.execute(sql`
      INSERT INTO daily_summaries (user_id, date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
      SELECT
        m.user_id,
        (m.recorded_at AT TIME ZONE 'UTC')::date AS date,
        m.metric_type_id,
        AVG(m.value),
        MIN(m.value),
        MAX(m.value),
        COUNT(*)::int,
        MAX(m.recorded_at)
      FROM metrics m
      JOIN (VALUES ${valuesList}) AS t(mid, d)
        ON m.metric_type_id = t.mid
       AND m.recorded_at >= (t.d || ' 00:00:00+00')::timestamptz
       AND m.recorded_at < ((t.d || ' 00:00:00+00')::timestamptz + INTERVAL '1 day')
      WHERE m.user_id = ${userId}
      GROUP BY m.user_id, (m.recorded_at AT TIME ZONE 'UTC')::date, m.metric_type_id
      ON CONFLICT (user_id, date, metric_type_id)
      DO UPDATE SET
        avg_value = excluded.avg_value,
        min_value = excluded.min_value,
        max_value = excluded.max_value,
        count = excluded.count,
        last_ingest_at = excluded.last_ingest_at;
    `);

    // Sweep cells in this chunk that ended up with zero rows (e.g. a
    // deferred update shifted every row out of the bucket). Mirrors
    // recomputeDailySummary's per-bucket DELETE.
    await conn.execute(sql`
      DELETE FROM daily_summaries ds
      USING (VALUES ${valuesList}) AS t(mid, d)
      WHERE ds.user_id = ${userId}
        AND ds.metric_type_id = t.mid
        AND ds.date = t.d::date
        AND NOT EXISTS (
          SELECT 1 FROM metrics m
          WHERE m.user_id = ${userId}
            AND m.metric_type_id = t.mid
            AND m.recorded_at >= (t.d || ' 00:00:00+00')::timestamptz
            AND m.recorded_at < ((t.d || ' 00:00:00+00')::timestamptz + INTERVAL '1 day')
        );
    `);
  }
}

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
  activityId: number;
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
      // too (its rows shifted out). Both go through recomputeOrDefer
      // so the bulk-import path can batch them; live ingest still gets
      // immediate recomputes.
      await recomputeOrDefer(input.userId, input.metricTypeId, input.recordedAt, db);
      if (existing[0].recordedAt.slice(0, 10) !== input.recordedAt.slice(0, 10)) {
        await recomputeOrDefer(input.userId, existing[0].metricTypeId, existing[0].recordedAt, db);
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

  await recomputeOrDefer(input.userId, input.metricTypeId, input.recordedAt, db);
  return "accepted";
}

/**
 * Look up an existing event by source_id first, then fall back to the
 * (started_at, activity_id, type) natural key. Used by CSV importers that
 * attach child rows (event_metrics, workout_sets) to parent events —
 * source_id wins when present, natural key handles manual rows.
 */
export async function resolveEventId(input: {
  userId: number;
  sourceId: string;
  startedAt: string;
  activityId: number;
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
        eq(events.activityId, input.activityId),
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
    activityId: input.activityId,
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

  // Half-open range on recorded_at uses the (metric_type_id, recorded_at)
  // index. The legacy `substr(recorded_at, 1, 10) = ${date}` predicate
  // would force a per-row text cast and lose the index after the
  // text→timestamptz migration.
  await db.execute(sql`
    INSERT INTO daily_summaries (user_id, date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
    SELECT
      user_id,
      (recorded_at AT TIME ZONE 'UTC')::date AS date,
      metric_type_id,
      AVG(value),
      MIN(value),
      MAX(value),
      COUNT(*)::int,
      MAX(recorded_at)
    FROM metrics
    WHERE user_id = ${userId}
      AND metric_type_id = ${metricTypeId}
      AND recorded_at >= (${date} || ' 00:00:00+00')::timestamptz
      AND recorded_at < ((${date} || ' 00:00:00+00')::timestamptz + INTERVAL '1 day')
    GROUP BY user_id, (recorded_at AT TIME ZONE 'UTC')::date, metric_type_id
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
  //
  // Both sides of every comparison are explicit-offset to avoid the
  // session-TimeZone trap (`'2026-01-01'::timestamptz` is interpreted
  // in the session TZ, not UTC). Concatenating ` 00:00:00+00` and
  // parsing as text pins to UTC unambiguously.
  await db.execute(sql`
    DELETE FROM daily_summaries
    WHERE user_id = ${userId}
      AND metric_type_id = ${metricTypeId}
      AND date = ${date}::date
      AND NOT EXISTS (
        SELECT 1 FROM metrics
        WHERE user_id = ${userId}
          AND metric_type_id = ${metricTypeId}
          AND recorded_at >= (${date} || ' 00:00:00+00')::timestamptz
          AND recorded_at < ((${date} || ' 00:00:00+00')::timestamptz + INTERVAL '1 day')
      );
  `);
}
