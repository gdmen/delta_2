import { db } from "@/db";
import { workoutSets, events, metricTypes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ExercisesTable } from "./exercises-table";
import { DataTabShell } from "@/components/data-tab-shell";

export const dynamic = "force-dynamic";

/**
 * Exercises are metric_types referenced from workout_sets. The INNER JOIN on
 * workout_sets is the partition — only metric_types that actually appear as
 * an exercise show up here. A metric_type that's both sampled (metric_readings)
 * and an exercise (workout_sets) legitimately appears on both tabs.
 */
export default async function ExercisesPage() {
  const rows = await db
    .select({
      id: metricTypes.id,
      name: metricTypes.name,
      unit: metricTypes.unit,
      sets: sql<number>`COUNT(${workoutSets.id})`,
      eventCount: sql<number>`COUNT(DISTINCT ${workoutSets.eventId})`,
      firstAt: sql<string>`MIN(${events.startedAt})`,
      lastAt: sql<string>`MAX(${events.startedAt})`,
    })
    .from(metricTypes)
    .innerJoin(workoutSets, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    .leftJoin(events, eq(events.id, workoutSets.eventId))
    .groupBy(metricTypes.id)
    .orderBy(sql`COUNT(${workoutSets.id}) DESC`);

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    sets: Number(r.sets),
    eventCount: Number(r.eventCount),
    firstAt: r.firstAt,
    lastAt: r.lastAt,
  }));

  return (
    <DataTabShell
      active="exercises"
      description="Exercises live as metric_types rows referenced from workout_sets. Merge variants here so analytics see one canonical name; future imports route through the same alias table as sampled metrics."
      label="Exercises"
      count={{ value: data.length, unit: data.length === 1 ? "name" : "names" }}
    >
      <ExercisesTable rows={data} />
    </DataTabShell>
  );
}
