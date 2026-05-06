import { db } from "@/db";
import { events, metrics, metricTypes, workoutSets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveComputedSamples } from "./computed-metrics";

export interface Series {
  samples: Array<{ date: string; value: number }>;
  unit: string;
  /** Target from metric_types (single source of truth). null if unset. */
  target: number | null;
  /** Target direction: true = floor, false = ceiling. Default true. */
  higherIsBetter: boolean;
}

/**
 * Lookup metric_type by name once (carries unit + target + direction +
 * frequencyHint). When the name doesn't exist we still return a usable
 * Series so the caller can render an empty placeholder rather than
 * crashing.
 */
async function loadType(metricName: string) {
  const rows = await db
    .select({
      id: metricTypes.id,
      unit: metricTypes.unit,
      target: metricTypes.target,
      higherIsBetter: metricTypes.higherIsBetter,
      frequencyHint: metricTypes.frequencyHint,
    })
    .from(metricTypes)
    .where(eq(metricTypes.name, metricName))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Daily-aggregated metrics — one observation per calendar day where the
 * value rolls up the day's worth of activity (steps, sleep hours, sport
 * minutes, *_max). Today's value is mid-flight and would mislead trends,
 * so we drop it from the series. Detection:
 *   - Computed metric (every family in computed-metrics.ts is per-day).
 *   - frequencyHint === "daily" on the metric_types row.
 * Instantaneous metrics (body weight, body fat %, set-by-set lifts) are
 * unaffected — today's reading IS complete.
 */
function isDailyAggregate(
  type: { frequencyHint: string | null } | null,
  computed: Array<{ date: string; value: number }> | null,
): boolean {
  return computed !== null || type?.frequencyHint === "daily";
}

/** Start-of-today in server-local time, as epoch ms. Server colocates
 * with the single user, so local-time matches the user's "today". Epoch
 * ms (not ISO string) because two ISO strings for the same instant in
 * different offsets — e.g. `2026-05-05T00:00:00-07:00` and the
 * equivalent `2026-05-05T07:00:00.000Z` — sort differently as strings
 * but are equal as instants. The first form is what Apple Health writes
 * for daily metrics; lexicographic compare wrongly lets it through. */
function startOfTodayLocalMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function excludeTodayIfDaily(
  samples: Array<{ date: string; value: number }>,
  type: { frequencyHint: string | null } | null,
  computed: Array<{ date: string; value: number }> | null,
): Array<{ date: string; value: number }> {
  if (!isDailyAggregate(type, computed)) return samples;
  const cutoffMs = startOfTodayLocalMs();
  return samples.filter((s) => Date.parse(s.date) < cutoffMs);
}

/**
 * Read every workout_set referencing this metric_type and fan each set out
 * into `reps` synthesized samples — one per rep, all sharing the parent
 * event's `started_at`. The value is the workout_set's `weight` column,
 * which means added load (added belt for body-weight exercises, bar weight
 * for barbell exercises). Treating each rep as an independent reading keeps
 * the synthesis lossless: a 5-rep set with `weight=185` becomes 5 samples
 * of 185 at the same instant.
 *
 * IMPORTANT — these samples are NOT stored in `metrics`. They're computed
 * at read time. The contract that consumers see (a Series with samples) is
 * the same whether the data is stored or synthesized; the cost we pay is
 * the per-read scan, which at current scale (~3K synthesized rows max per
 * exercise) is a sub-100ms operation. If/when this gets hot enough to
 * materialize, the migration is the synthesis function pointed at INSERT
 * instead of array `concat` — see commit message for full rationale.
 */
async function loadSyntheticSamples(
  metricTypeId: number,
): Promise<Array<{ date: string; value: number }>> {
  const setRows = await db
    .select({
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .where(eq(workoutSets.exerciseMetricTypeId, metricTypeId));

  const out: Array<{ date: string; value: number }> = [];
  for (const r of setRows) {
    for (let i = 0; i < r.reps; i++) {
      out.push({ date: r.startedAt, value: r.weight });
    }
  }
  return out;
}

/**
 * Build a Series from samples + the metric_types row's metadata. Used by
 * both the primitive/synthesized path and the computed path so they
 * return the same shape.
 */
function makeSeries(
  samples: Array<{ date: string; value: number }>,
  type: { unit: string; target: number | null; higherIsBetter: boolean } | null,
): Series {
  return {
    samples,
    unit: type?.unit ?? "",
    target: type?.target ?? null,
    higherIsBetter: type?.higherIsBetter ?? true,
  };
}

function sortByDate(samples: Array<{ date: string; value: number }>) {
  return samples.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function filterSince(samples: Array<{ date: string; value: number }>, sinceIso: string) {
  return samples.filter((s) => s.date >= sinceIso);
}

/** Pull the full history of a metric, ordered oldest-to-newest.
 * Daily-aggregate metrics (computed families, frequencyHint === "daily")
 * drop today's still-mid-flight value. */
export async function getAllHistory(metricName: string): Promise<Series> {
  const type = await loadType(metricName);

  // Computed metrics are pattern-matched on name. They route around the
  // metrics + workout_sets fanout and return their own samples; metadata
  // (unit/target/higherIsBetter) still comes from the metric_types row,
  // which is auto-seeded so it always exists.
  const computed = await resolveComputedSamples(metricName);
  if (computed !== null) {
    return makeSeries(sortByDate(excludeTodayIfDaily(computed, type, computed)), type);
  }

  if (!type) return makeSeries([], null);

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id));

  const real = rows.map((r) => ({ date: r.recordedAt, value: r.value }));
  const synthetic = await loadSyntheticSamples(type.id);
  return makeSeries(
    sortByDate(excludeTodayIfDaily([...real, ...synthetic], type, computed)),
    type,
  );
}

/** Pull the last N days of a metric, ordered oldest-to-newest.
 * Daily-aggregate metrics (computed families, frequencyHint === "daily")
 * drop today's still-mid-flight value. */
export async function getLastDays(metricName: string, days: number): Promise<Series> {
  const type = await loadType(metricName);

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const computed = await resolveComputedSamples(metricName);
  if (computed !== null) {
    return makeSeries(
      sortByDate(excludeTodayIfDaily(filterSince(computed, sinceIso), type, computed)),
      type,
    );
  }

  if (!type) return makeSeries([], null);

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id));

  const real = rows.map((r) => ({ date: r.recordedAt, value: r.value }));
  const synthetic = await loadSyntheticSamples(type.id);
  return makeSeries(
    sortByDate(
      excludeTodayIfDaily(filterSince([...real, ...synthetic], sinceIso), type, computed),
    ),
    type,
  );
}

