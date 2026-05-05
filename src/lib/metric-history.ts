import { db } from "@/db";
import { events, metrics, metricTypes, workoutSets } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface Series {
  samples: Array<{ date: string; value: number }>;
  unit: string;
  /** Target from metric_types (single source of truth). null if unset. */
  target: number | null;
  /** Target direction: true = floor, false = ceiling. Default true. */
  higherIsBetter: boolean;
}

/**
 * Lookup metric_type by name once (carries unit + target + direction). When
 * the name doesn't exist we still return a usable Series so the caller can
 * render an empty placeholder rather than crashing.
 */
async function loadType(metricName: string) {
  const rows = await db
    .select({
      id: metricTypes.id,
      unit: metricTypes.unit,
      target: metricTypes.target,
      higherIsBetter: metricTypes.higherIsBetter,
    })
    .from(metricTypes)
    .where(eq(metricTypes.name, metricName))
    .limit(1);
  return rows[0] ?? null;
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

/** Pull the full history of a metric, no time window. */
export async function getAllHistory(metricName: string): Promise<Series> {
  const type = await loadType(metricName);
  if (!type) return { samples: [], unit: "", target: null, higherIsBetter: true };

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id));

  const real = rows.map((r) => ({ date: r.recordedAt, value: r.value }));
  const synthetic = await loadSyntheticSamples(type.id);
  const samples = [...real, ...synthetic].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return {
    samples,
    unit: type.unit,
    target: type.target,
    higherIsBetter: type.higherIsBetter,
  };
}

/** Pull the last N days of a metric, ordered oldest-to-newest. */
export async function getLastDays(metricName: string, days: number): Promise<Series> {
  const type = await loadType(metricName);
  if (!type) return { samples: [], unit: "", target: null, higherIsBetter: true };

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id));

  const real = rows.map((r) => ({ date: r.recordedAt, value: r.value }));
  const synthetic = await loadSyntheticSamples(type.id);
  const samples = [...real, ...synthetic]
    .filter((s) => s.date >= sinceIso)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    samples,
    unit: type.unit,
    target: type.target,
    higherIsBetter: type.higherIsBetter,
  };
}

