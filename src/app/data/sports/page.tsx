import { db } from "@/db";
import { sports, events, focuses, goals } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { DataTabs } from "../tabs";
import { ImportExportBar } from "../import-export-bar";
import { SportsTable } from "./sports-table";

export const dynamic = "force-dynamic";

/**
 * Data browser — Sports tab. One row per sport with counts of dependent
 * records, selectable for merge.
 */
export default async function SportsPage() {
  // Counts with LEFT JOINs so zero-row sports still show up.
  const eventCounts = await db
    .select({ sportId: events.sportId, c: sql<number>`count(*)` })
    .from(events)
    .groupBy(events.sportId);
  const focusCounts = await db
    .select({ sportId: focuses.sportId, c: sql<number>`count(*)` })
    .from(focuses)
    .groupBy(focuses.sportId);
  const goalCounts = await db
    .select({ sportId: goals.sportId, c: sql<number>`count(*)` })
    .from(goals)
    .groupBy(goals.sportId);
  const lastEvents = await db
    .select({ sportId: events.sportId, last: sql<string>`max(${events.startedAt})` })
    .from(events)
    .groupBy(events.sportId);

  const eventCountBy = new Map(eventCounts.map((r) => [r.sportId, Number(r.c)]));
  const focusCountBy = new Map(focusCounts.map((r) => [r.sportId, Number(r.c)]));
  const goalCountBy = new Map(goalCounts.map((r) => [r.sportId, Number(r.c)]));
  const lastEventBy = new Map(lastEvents.map((r) => [r.sportId, r.last]));

  const sportRows = await db
    .select()
    .from(sports)
    .orderBy(sql`(SELECT count(*) FROM ${events} WHERE ${events.sportId} = ${sports.id}) DESC`);

  const rows = sportRows.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    eventCount: eventCountBy.get(s.id) ?? 0,
    focusCount: focusCountBy.get(s.id) ?? 0,
    goalCount: goalCountBy.get(s.id) ?? 0,
    lastEventAt: lastEventBy.get(s.id) ?? null,
  }));

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-2xl font-semibold mb-2">Data</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Every row Delta has stored. Click through to manage sport-attached events, goals, and focuses — or merge duplicates with the selection tools here.
      </p>

      <div className="mb-8">
        <ImportExportBar />
      </div>

      <DataTabs active="sports" />

      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Sports
        </span>
        <span className="font-mono text-[0.6875rem] text-muted">
          {rows.length} sport{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <SportsTable rows={rows} />
    </div>
  );
}
