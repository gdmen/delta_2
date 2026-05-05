import { db } from "@/db";
import { events, metrics, metricTypes, workoutSets } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { MetricsTable } from "./metrics-table";
import { DataTabShell } from "@/components/data-tab-shell";

export const dynamic = "force-dynamic";

export default async function DataPage() {
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
    .leftJoin(metrics, eq(metrics.metricTypeId, metricTypes.id))
    .groupBy(metricTypes.id);

  // Synthesized rows from workout_sets — same per-rep fanout the
  // metric-history library computes at read time. We need the total here so
  // exercise-only metric_types (e.g. Flat Barbell Bench Press) report a
  // truthful count instead of 0. last-recorded comes from the parent
  // event's started_at.
  const synthRows = await db
    .select({
      metricTypeId: workoutSets.exerciseMetricTypeId,
      reps: sql<number>`coalesce(sum(${workoutSets.reps}), 0)`,
      lastAt: sql<string>`max(${events.startedAt})`,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .groupBy(workoutSets.exerciseMetricTypeId);

  const synthByType = new Map<number, { count: number; lastAt: string | null }>();
  for (const r of synthRows) {
    synthByType.set(r.metricTypeId, {
      count: Number(r.reps),
      lastAt: r.lastAt ?? null,
    });
  }

  const rows = realRows
    .map((t) => {
      const synth = synthByType.get(t.id);
      const realCount = Number(t.count);
      const synthCount = synth?.count ?? 0;
      // Pick the more recent of the two timestamps. SQLite returns ISO-ish
      // strings for both so lexicographic compare is correct.
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
