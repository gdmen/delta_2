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
  mergeLog,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

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
  const tables: Array<{ name: string; obj: PgTable }> = [
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
    // merge_log: no FK to other tables (canonical_id is by-value, not
    // by-FK, so a deleted metric_type doesn't cascade-delete the audit
    // row). Wipe just clears the audit history.
    { name: "merge_log", obj: mergeLog },
    { name: "source_settings", obj: sourceSettings },
    { name: "import_sources", obj: importSources },
    // Dashboards: widgets first so the FK from dashboard_widgets ->
    // dashboards doesn't fight us if FKs ever flip back on mid-wipe.
    { name: "dashboard_widgets", obj: dashboardWidgets },
    { name: "dashboards", obj: dashboards },
  ];

  // Count rows per table BEFORE wiping for the response payload.
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const r = await db.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${t.name}"`)}`,
    );
    counts[t.name] = (r[0] as { n: number }).n;
  }

  // ONE TRUNCATE statement covering every table at once, with
  // `RESTART IDENTITY CASCADE`. Critical: a per-table loop deadlocks
  // because each CASCADE acquires AccessExclusive locks on dependent
  // tables in different orders across iterations. Single-statement
  // TRUNCATE acquires every lock atomically, no deadlock window.
  // Mirrors what scripts/wipe-data.sh does with one TRUNCATE.
  const tableList = sql.raw(tables.map((t) => `"${t.name}"`).join(", "));
  await db.execute(
    sql`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );

  return NextResponse.json({
    ok: true,
    deletedCounts: counts,
    note: "ingest_configs preserved; reload the page to see the empty state",
  });
}
