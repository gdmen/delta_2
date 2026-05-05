import { db } from "@/db";
import { sports, events, focuses, goals } from "@/db/schema";
import { and, eq, like, or, sql } from "drizzle-orm";
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
    // Count only manual focuses — un-promoted LLM proposals shouldn't
    // inflate the "you have N focuses" thumb-rule.
    .leftJoin(
      focuses,
      and(eq(focuses.goalId, goals.id), eq(focuses.source, "manual")),
    )
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

  // Source-prefixed orphans: rows the importers auto-created that the user
  // hasn't yet merged into a canonical name. The badge nudges merging
  // without baking opinionated mappings into the importer code.
  const orphanRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(sports)
    .where(
      or(
        like(sports.name, "strava:%"),
        like(sports.name, "apple_health:%"),
        like(sports.name, "bodyspec:%"),
      ),
    );
  const orphanCount = Number(orphanRows[0]?.c ?? 0);

  return (
    <DataTabShell
      active="sports"
      description="Every row Delta has stored. Click through to manage sport-attached events, goals, and focuses — or merge duplicates with the selection tools here."
      label="Sports"
      count={{ value: data.length, unit: data.length === 1 ? "sport" : "sports" }}
    >
      {orphanCount > 0 && (
        <div className="mb-3 text-[0.6875rem] font-mono text-accent-orange">
          {orphanCount} unmerged
          <span className="text-muted">
            {" "}
            — auto-created from imports. Select rows below and merge into a
            canonical name.
          </span>
        </div>
      )}
      <SportsTable rows={data} />
    </DataTabShell>
  );
}
