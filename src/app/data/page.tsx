import { db } from "@/db";
import { events, metrics, metricTypes, sports, workoutSets } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { MetricsTable } from "./metrics-table";
import { DataTabShell } from "@/components/data-tab-shell";
import { matchComputed, slugifyExercise } from "@/lib/computed-metrics";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  const user = await requireUserOrSignin();
  // Real metric rows per metric_type.
  const realRows = await db
    .select({
      id: metricTypes.id,
      name: metricTypes.name,
      unit: metricTypes.unit,
      count: sql<number>`count(${metrics.id})`,
      lastAt: sql<string>`max(${metrics.recordedAt})`,
    })
    .from(metricTypes)
    .leftJoin(metrics, and(userScope(user.id).metrics, eq(metrics.metricTypeId, metricTypes.id)))
    .where(userScope(user.id).metricTypes)
    .groupBy(metricTypes.id);

  // Synthesized rows from workout_sets — same per-rep fanout the
  // metric-history library computes at read time. We need the total here so
  // exercise-only metric_types (e.g. Flat Barbell Bench Press) report a
  // truthful count instead of 0. last-recorded comes from the parent
  // event's started_at.
  // INHERIT scoping: workout_sets has no user_id; restrict via events.
  const synthRows = await db
    .select({
      metricTypeId: workoutSets.exerciseMetricTypeId,
      reps: sql<number>`coalesce(sum(${workoutSets.reps}), 0)`,
      lastAt: sql<string>`max(${events.startedAt})`,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .where(userScope(user.id).events)
    .groupBy(workoutSets.exerciseMetricTypeId);

  const synthByType = new Map<number, { count: number; lastAt: string | null }>();
  for (const r of synthRows) {
    synthByType.set(r.metricTypeId, {
      count: Number(r.reps),
      lastAt: r.lastAt ?? null,
    });
  }

  // Aggregates feeding the computed-metric counts. One round-trip each;
  // the resolver in computed-metrics.ts does the same arithmetic at read
  // time. We avoid calling the resolver for every row (~600 metric_types
  // would be ~600 queries) by precomputing per-sport and per-exercise
  // day counts here and looking them up by name match.
  const sportDayCounts = await db
    .select({
      sportId: events.sportId,
      sportName: sports.name,
      days: sql<number>`count(distinct to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'))`,
      daysWithMinutes: sql<number>`count(distinct case when ${events.durationMinutes} > 0 then to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') end)`,
      lastAt: sql<string>`max(${events.startedAt})`,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(userScope(user.id).events)
    .groupBy(events.sportId, sports.name);
  const bySport = new Map<string, { days: number; daysWithMinutes: number; lastAt: string | null }>();
  for (const r of sportDayCounts) {
    bySport.set(r.sportName, {
      days: Number(r.days),
      daysWithMinutes: Number(r.daysWithMinutes),
      lastAt: r.lastAt ?? null,
    });
  }

  const exerciseDayCounts = await db
    .select({
      metricTypeId: workoutSets.exerciseMetricTypeId,
      name: metricTypes.name,
      days: sql<number>`count(distinct to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'))`,
      lastAt: sql<string>`max(${events.startedAt})`,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(metricTypes, eq(metricTypes.id, workoutSets.exerciseMetricTypeId))
    .where(userScope(user.id).events)
    .groupBy(workoutSets.exerciseMetricTypeId, metricTypes.name);
  const byExerciseSlug = new Map<string, { days: number; lastAt: string | null }>();
  for (const r of exerciseDayCounts) {
    const slug = slugifyExercise(r.name);
    if (!slug) continue;
    byExerciseSlug.set(slug, {
      days: Number(r.days),
      lastAt: r.lastAt ?? null,
    });
  }

  const rows = realRows
    .map((t) => {
      // Computed metric? Skip the real+synth path — the underlying tables
      // hold no rows for these names. Pull the count from the per-sport /
      // per-exercise aggregates above.
      const computed = matchComputed(t.name);
      if (computed) {
        let count = 0;
        let lastAt: string | null = null;
        switch (computed.family) {
          case "sport_sessions_count": {
            const s = bySport.get(computed.subject);
            count = s?.days ?? 0;
            lastAt = s?.lastAt ?? null;
            break;
          }
          case "sport_minutes": {
            const s = bySport.get(computed.subject);
            count = s?.daysWithMinutes ?? 0;
            lastAt = s?.lastAt ?? null;
            break;
          }
          case "exercise_max":
          case "exercise_max_12mo":
          case "exercise_e1rm":
          case "exercise_volume_per_day": {
            const ex = byExerciseSlug.get(computed.subject);
            // Day count is an upper bound for *_max (PRs ≤ workout-days).
            // Exact for *_e1rm and *_volume_per_day (one sample per day).
            // Trailing-12mo collapses consecutive equal samples so it can be
            // less than this; close enough for a "data exists" indicator.
            count = ex?.days ?? 0;
            lastAt = ex?.lastAt ?? null;
            break;
          }
        }
        return {
          id: t.id,
          name: t.name,
          unit: t.unit,
          count,
          lastAt,
        };
      }

      const synth = synthByType.get(t.id);
      const realCount = Number(t.count);
      const synthCount = synth?.count ?? 0;
      // Pick the more recent of the two timestamps. Both columns store
      // ISO 8601 strings, so lexicographic compare is correct.
      const realLast = t.lastAt;
      const synthLast = synth?.lastAt ?? null;
      const lastAt =
        realLast && synthLast ? (realLast > synthLast ? realLast : synthLast) : realLast ?? synthLast;
      return {
        id: t.id,
        name: t.name,
        unit: t.unit,
        count: realCount + synthCount,
        lastAt,
      };
    })
    .sort((a, b) => b.count - a.count);

  return (
    <DataTabShell
      active="metrics"
      description="Every row Delta has stored. Click a metric to view, edit, add, or delete data points."
      label="Metrics"
      count={{ value: rows.length, unit: "types" }}
    >
      <MetricsTable rows={rows} />
    </DataTabShell>
  );
}
