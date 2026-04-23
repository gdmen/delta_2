import { db } from "@/db";
import { workoutSets, events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ExercisesTable } from "./exercises-table";
import { DataTabShell } from "@/components/data-tab-shell";

export const dynamic = "force-dynamic";

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
    <DataTabShell
      active="exercises"
      description="Every row Delta has stored. Exercise names come straight from imported workout sets — merge variants here so analytics see one canonical name."
      label="Exercises"
      count={{ value: data.length, unit: data.length === 1 ? "name" : "names" }}
    >
      <ExercisesTable rows={data} />
    </DataTabShell>
  );
}
