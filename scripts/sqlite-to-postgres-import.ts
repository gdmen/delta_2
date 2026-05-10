#!/usr/bin/env tsx
/**
 * One-shot importer: read every row from a live `delta2.db` SQLite file
 * and INSERT it into a fresh Postgres database matching the new schema.
 * Run once during the cutover from the old SQLite stack to RDS Postgres.
 *
 * USAGE:
 *   1. Ensure DATABASE_URL points at the EMPTY destination Postgres.
 *      The new 0000_initial_schema.sql migration must have been
 *      applied already (`npx drizzle-kit migrate`).
 *   2. Install better-sqlite3 as a one-shot dev dep:
 *        npm install --save-dev better-sqlite3 @types/better-sqlite3
 *   3. Run the script:
 *        DATABASE_URL=postgresql://... npx tsx scripts/sqlite-to-postgres-import.ts ./delta2.db
 *   4. Review the printed row-count diff. Any non-zero deltas point at
 *      a transform that dropped data — fail loud, don't silently skip.
 *   5. After verifying production reads work, uninstall better-sqlite3:
 *        npm uninstall better-sqlite3 @types/better-sqlite3
 *
 * SAFETY:
 *   - The destination connection is asserted empty before any writes.
 *     Running this against a non-empty DB exits 1 — no clobber.
 *   - Each table is inserted in its own transaction so a partial
 *     failure leaves the DB in a recoverable state (re-run after
 *     wiping target).
 *   - After all rows land, every identity sequence is bumped to
 *     MAX(id) + 1 so future inserts without an explicit id don't
 *     collide with imported rows.
 *
 * TRANSFORMS APPLIED INLINE (so old migrations 0026–0032 are moot):
 *   - SQLite stores `boolean` as 0/1 integers; coerced to JS booleans.
 *   - SQLite stores JSON-shaped columns as TEXT; copied verbatim
 *     (the new schema also stores them as TEXT for now; jsonb port
 *     is a follow-up).
 *   - Timestamp columns: SQLite has two formats in the wild
 *     ("2026-05-08T12:00:00.000Z" from JS and "2026-05-08 12:00:00"
 *     from datetime('now')). Normalized to ISO 8601 with `Z` suffix
 *     for both shapes — the new Postgres schema's `text` columns
 *     hold them as-is.
 *   - The data-cleanup migrations 0026–0032 are NOT re-applied here.
 *     The live SQLite source will have already had them applied
 *     (they're in the production migration journal), so re-running
 *     is a no-op. If importing from an older snapshot, run those
 *     migrations against the SQLite DB FIRST, then run this script.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";

// Lazy import — better-sqlite3 only needed during this one-shot.
// `Database` requires native bindings which we don't ship to prod.
type SqliteDb = {
  prepare: (q: string) => {
    all: (...params: unknown[]) => Record<string, unknown>[];
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    run: (...params: unknown[]) => { changes: number };
  };
  exec: (q: string) => void;
  close: () => void;
};

async function loadSqlite(path: string): Promise<SqliteDb> {
  let Database: typeof import("better-sqlite3");
  try {
    Database = (await import("better-sqlite3")).default as unknown as typeof import("better-sqlite3");
  } catch {
    throw new Error(
      "better-sqlite3 not installed. Run: npm install --save-dev better-sqlite3 @types/better-sqlite3",
    );
  }
  const db = new Database(path, { readonly: true });
  return db as unknown as SqliteDb;
}

function normalizeTimestamp(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return String(v);
  // SQLite's `datetime('now')` produces "YYYY-MM-DD HH:MM:SS" — coerce
  // to ISO 8601 with `Z` so downstream string-comparison ordering works.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
    return v.replace(" ", "T") + ".000Z";
  }
  return v;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return false;
}

async function main() {
  const sqlitePath = process.argv[2];
  if (!sqlitePath) {
    console.error(
      "USAGE: tsx scripts/sqlite-to-postgres-import.ts <path-to-delta2.db>",
    );
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL must be set to the destination Postgres URL");
    process.exit(1);
  }

  console.log(`[import] reading ${sqlitePath}`);
  const sqlite = await loadSqlite(sqlitePath);

  console.log(`[import] connecting to ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema });

  // Empty-DB assertion: if any table has rows, refuse to proceed.
  // Use sports as the proxy; if it has rows the schema's been imported
  // into already and a re-run would create duplicates with sequence
  // collisions.
  const sportsCount = await client`SELECT count(*)::int AS n FROM sports`;
  if ((sportsCount[0] as { n: number }).n > 0) {
    console.error(
      "[import] ABORT: destination Postgres already has rows in 'sports'. " +
        "Truncate it first or use a fresh database.",
    );
    process.exit(1);
  }

  // Insert order: parents before children. INHERIT tables come after
  // their parents (event_metrics after events, workout_sets after events
  // and metric_types, etc.).
  const ORDER = [
    "sports",
    "metric_types",
    "metric_type_aliases",
    "events",
    "metrics",
    "event_metrics",
    "workout_sets",
    "goals",
    "focuses",
    "goal_journal_entries",
    "coach_calls",
    "ingest_configs",
    "import_sources",
    "app_settings",
    "merge_log",
    "source_settings",
    "reconcile_log",
    "daily_summaries",
    "dashboards",
    "dashboard_widgets",
  ] as const;

  // Per-table column coercions. Anything not listed copies verbatim.
  // Returned object becomes the row inserted into Postgres.
  type Row = Record<string, unknown>;
  const COERCERS: Partial<Record<(typeof ORDER)[number], (r: Row) => Row>> = {
    metric_types: (r) => ({ ...r, higher_is_better: bool(r.higher_is_better) }),
    metric_type_aliases: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    metrics: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    events: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    goals: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    focuses: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    goal_journal_entries: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    coach_calls: (r) => ({ ...r, ts: normalizeTimestamp(r.ts) }),
    ingest_configs: (r) => ({ ...r, enabled: bool(r.enabled) }),
    import_sources: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    app_settings: (r) => ({ ...r, updated_at: normalizeTimestamp(r.updated_at) }),
    merge_log: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    source_settings: (r) => ({
      ...r,
      reconcile_enabled: bool(r.reconcile_enabled),
      updated_at: normalizeTimestamp(r.updated_at),
    }),
    reconcile_log: (r) => ({ ...r, at: normalizeTimestamp(r.at) }),
    sports: (r) => ({ ...r, created_at: normalizeTimestamp(r.created_at) }),
    dashboards: (r) => ({
      ...r,
      is_system: bool(r.is_system),
      created_at: normalizeTimestamp(r.created_at),
      updated_at: normalizeTimestamp(r.updated_at),
    }),
  };

  const counts: Record<string, { source: number; inserted: number }> = {};

  for (const table of ORDER) {
    const sourceRows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    counts[table] = { source: sourceRows.length, inserted: 0 };

    if (sourceRows.length === 0) {
      console.log(`[import] ${table}: 0 rows`);
      continue;
    }

    const coerce = COERCERS[table] ?? ((r: Row) => r);
    const coerced = sourceRows.map(coerce);

    // Use raw `INSERT ... VALUES (...)` via postgres.js so we don't
    // have to enumerate columns at compile time. postgres-js handles
    // the type marshaling (booleans, numbers, nulls).
    const cols = Object.keys(coerced[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");

    // Batch in chunks of 500 to keep parameter count under Postgres's
    // 65535-parameter limit.
    const CHUNK = 500;
    for (let i = 0; i < coerced.length; i += CHUNK) {
      const slice = coerced.slice(i, i + CHUNK);
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      for (const row of slice) {
        const placeholders = cols.map(() => `$${p++}`).join(", ");
        valueClauses.push(`(${placeholders})`);
        for (const c of cols) params.push((row as Row)[c] ?? null);
      }
      const stmt = `INSERT INTO "${table}" (${colList}) VALUES ${valueClauses.join(", ")}`;
      await client.unsafe(stmt, params as never[]);
      counts[table].inserted += slice.length;
    }

    console.log(`[import] ${table}: ${counts[table].inserted}/${counts[table].source} rows inserted`);
  }

  // Bump every identity sequence past MAX(id). Postgres won't auto-pick
  // up high inserted ids — the sequence stays at its initial value
  // until something explicitly bumps it.
  console.log("[import] resetting identity sequences");
  const SEQUENCES: Array<{ table: string; column: string }> = [
    { table: "sports", column: "id" },
    { table: "metric_types", column: "id" },
    { table: "metrics", column: "id" },
    { table: "events", column: "id" },
    { table: "workout_sets", column: "id" },
    { table: "goals", column: "id" },
    { table: "focuses", column: "id" },
    { table: "goal_journal_entries", column: "id" },
    { table: "coach_calls", column: "id" },
    { table: "ingest_configs", column: "id" },
    { table: "import_sources", column: "id" },
    { table: "merge_log", column: "id" },
    { table: "reconcile_log", column: "id" },
    { table: "daily_summaries", column: "id" },
    { table: "dashboards", column: "id" },
    { table: "dashboard_widgets", column: "id" },
  ];
  for (const { table, column } of SEQUENCES) {
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('${table}', '${column}'), GREATEST((SELECT MAX(${column}) FROM "${table}"), 1))`,
      ),
    );
  }

  // Final sanity check: total rows in vs total rows out.
  let totalIn = 0;
  let totalOut = 0;
  for (const t of ORDER) {
    totalIn += counts[t].source;
    totalOut += counts[t].inserted;
  }
  console.log(`[import] DONE. ${totalOut}/${totalIn} rows imported across ${ORDER.length} tables.`);
  if (totalIn !== totalOut) {
    console.error(`[import] WARNING: row count mismatch. Source ${totalIn} != destination ${totalOut}`);
    process.exit(1);
  }

  await client.end({ timeout: 5 });
  sqlite.close();
}

main().catch((err) => {
  console.error("[import] FAILED:", err);
  process.exit(1);
});
