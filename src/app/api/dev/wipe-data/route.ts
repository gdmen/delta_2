import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  workoutSets,
  eventMetrics,
  events,
  goalJournalEntries,
  focuses,
  goals,
  metricTypeAliases,
  metrics,
  metricTypes,
  sports,
  coachCalls,
  dailySummaries,
  reconcileLog,
  importSources,
  sourceSettings,
  dashboards,
  dashboardWidgets,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * POST /api/dev/wipe-data
 *
 * Hard-deletes every row of every table that round-trips through
 * /api/export + /api/import, plus the regeneratable cache/log tables. Used
 * for "wipe local + re-import a clean slate from prod" cycles during
 * development. Refuses to run in production (NODE_ENV === "production"
 * returns 404 — the endpoint should not exist there at all).
 *
 * NOT touched:
 *   - ingest_configs           — OAuth tokens / API keys; wiping them
 *                                forces re-auth which is annoying. Restore
 *                                separately if needed.
 *   - drizzle migration meta   — the schema stays put; we're wiping rows,
 *                                not schema.
 *
 * Order is leaf-tables-first, FKs disabled for the duration so we don't
 * have to be careful about cycles. Wrapped in a transaction so a failure
 * mid-wipe rolls back to the prior state.
 *
 * AUTOINCREMENT counters in sqlite_sequence are reset so the imported
 * data starts at id=1 cleanly.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Tables in deletion order — children before parents. With FKs OFF the
  // order doesn't strictly matter, but keeping it leaf-first means the
  // wipe is also correct if someone flips FKs back on inside the txn.
  // Imports stay on the schema objects so a deleted table breaks the
  // build instead of the runtime.
  const tables: Array<{ name: string; obj: SQLiteTable }> = [
    { name: "workout_sets", obj: workoutSets },
    { name: "event_metrics", obj: eventMetrics },
    { name: "goal_journal_entries", obj: goalJournalEntries },
    { name: "coach_calls", obj: coachCalls },
    { name: "focuses", obj: focuses },
    { name: "goals", obj: goals },
    { name: "events", obj: events },
    { name: "metrics", obj: metrics },
    { name: "metric_type_aliases", obj: metricTypeAliases },
    { name: "metric_types", obj: metricTypes },
    { name: "sports", obj: sports },
    { name: "daily_summaries", obj: dailySummaries },
    { name: "reconcile_log", obj: reconcileLog },
    { name: "source_settings", obj: sourceSettings },
    { name: "import_sources", obj: importSources },
    // Dashboards: widgets first so the FK from dashboard_widgets ->
    // dashboards doesn't fight us if FKs ever flip back on mid-wipe.
    { name: "dashboard_widgets", obj: dashboardWidgets },
    { name: "dashboards", obj: dashboards },
  ];

  const counts: Record<string, number> = {};

  // No transaction wrapper — better-sqlite3's drizzle binding requires a
  // SYNC callback and rejects async functions. We also can't toggle
  // PRAGMA foreign_keys inside a transaction (SQLite spec). Sequential
  // deletes in autocommit mode work fine here: each statement is its
  // own implicit txn, the PRAGMA OFF persists across them, and a power
  // loss mid-wipe only matters for a dev tool that's about to be
  // followed by a full re-import anyway.
  await db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    for (const t of tables) {
      const result = await db.delete(t.obj).run();
      counts[t.name] =
        typeof result === "object" && result !== null && "changes" in result
          ? Number((result as { changes?: unknown }).changes ?? 0)
          : 0;
    }
    // Reset AUTOINCREMENT so imported rows land with their original
    // ids (or restart at 1 if the source didn't have ids).
    // sqlite_sequence is auto-managed; deleting rows from it is the
    // supported reset.
    await db.run(sql`DELETE FROM sqlite_sequence`);
  } finally {
    // Always restore FK enforcement for downstream requests on this
    // connection, even if a delete threw mid-loop.
    await db.run(sql`PRAGMA foreign_keys = ON`);
  }

  return NextResponse.json({
    ok: true,
    deletedCounts: counts,
    note: "ingest_configs preserved; reload the page to see the empty state",
  });
}
