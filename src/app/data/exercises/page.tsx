import { db } from "@/db";
import { workoutSets, events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { DataTabs } from "../tabs";
import { ImportExportBar } from "../import-export-bar";
import { ExercisesTable } from "./exercises-table";

export const dynamic = "force-dynamic";

/**
 * Data browser — Exercises tab. Exercises live only as text on workout_sets
 * (no dedicated table), so this view derives one row per distinct
 * exercise_name with counts, selectable for merge.
 */
export default async function ExercisesPage() {
  const rows = await db
    .select({
      name: workoutSets.exerciseName,
      sets: sql<number>`COUNT(*)`,
      eventCount: sql<number>`COUNT(DISTINCT ${workoutSets.eventId})`,
      firstAt: sql<string>`MIN(${events.startedAt})`,
      lastAt: sql<string>`MAX(${events.startedAt})`,
    })
    .from(workoutSets)
    .innerJoin(events, eq(events.id, workoutSets.eventId))
    .groupBy(workoutSets.exerciseName)
    .orderBy(sql`COUNT(*) DESC`);

  const data = rows.map((r) => ({
    name: r.name,
    sets: Number(r.sets),
    eventCount: Number(r.eventCount),
    firstAt: r.firstAt,
    lastAt: r.lastAt,
  }));

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-2xl font-semibold mb-2">Data</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Every row Delta has stored. Exercise names come straight from imported
        workout sets — merge variants here so analytics see one canonical name.
      </p>

      <div className="mb-8">
        <ImportExportBar />
      </div>

      <DataTabs active="exercises" />

      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Exercises
        </span>
        <span className="font-mono text-[0.6875rem] text-muted">
          {data.length.toLocaleString()} name{data.length === 1 ? "" : "s"}
        </span>
      </div>
      <ExercisesTable rows={data} />
    </div>
  );
}
