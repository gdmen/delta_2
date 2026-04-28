import { db } from "@/db";
import { sports, events, focuses, goals } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { SportsTable } from "./sports-table";
import { DataTabShell } from "@/components/data-tab-shell";

export const dynamic = "force-dynamic";

export default async function SportsPage() {
  // One round-trip: left-join each dependent table, aggregate in SQL.
  // focus/goal counts need COUNT(DISTINCT) because the joins multiply.
  const rows = await db
    .select({
      id: sports.id,
      name: sports.name,
      color: sports.color,
      eventCount: sql<number>`COUNT(DISTINCT ${events.id})`,
      focusCount: sql<number>`COUNT(DISTINCT ${focuses.id})`,
      goalCount: sql<number>`COUNT(DISTINCT ${goals.id})`,
      lastEventAt: sql<string>`MAX(${events.startedAt})`,
    })
    .from(sports)
    .leftJoin(events, eq(events.sportId, sports.id))
    .leftJoin(goals, eq(goals.sportId, sports.id))
    // Focuses now reach their sport via the goal, not a direct sport_id.
    .leftJoin(focuses, eq(focuses.goalId, goals.id))
    .groupBy(sports.id)
    .orderBy(sql`COUNT(DISTINCT ${events.id}) DESC`);

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    eventCount: Number(r.eventCount),
    focusCount: Number(r.focusCount),
    goalCount: Number(r.goalCount),
    lastEventAt: r.lastEventAt,
  }));

  return (
    <DataTabShell
      active="sports"
      description="Every row Delta has stored. Click through to manage sport-attached events, goals, and focuses — or merge duplicates with the selection tools here."
      label="Sports"
      count={{ value: data.length, unit: data.length === 1 ? "sport" : "sports" }}
    >
      <SportsTable rows={data} />
    </DataTabShell>
  );
}
