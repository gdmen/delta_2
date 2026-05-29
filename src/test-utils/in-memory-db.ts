import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@/db/schema";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

/**
 * Build a fresh in-memory pglite (WASM Postgres) database with all
 * migrations applied. Production runs against a real Postgres via
 * `postgres-js`; tests use pglite so they don't need Docker or a
 * running Postgres daemon. The query surface is identical (Drizzle
 * abstracts the driver), so test behavior matches prod.
 *
 * The instance is isolated per call — call this in `beforeEach` if you
 * want a clean slate every test. pglite startup is async (loads the
 * WASM blob), so this function returns a Promise.
 *
 * Returns the drizzle handle (typed identical to the prod `db` import)
 * and a `clearSeedData` helper for tests that want to wipe rows but
 * keep the schema between cases.
 */
export async function createTestDb(): Promise<{
  db: PgliteDatabase<typeof schema>;
  pg: PGlite;
  clearSeedData: () => Promise<void>;
}> {
  const pg = new PGlite();
  // pglite resolves immediately but the underlying engine is lazy;
  // forcing a trivial query waits until it's ready.
  await pg.query("SELECT 1");

  const db = drizzle(pg, { schema });

  // Apply migrations by reading the journal and exec'ing each .sql file
  // verbatim. We don't use drizzle's programmatic migrate() here because
  // it expects to manage its own migrations table and we want raw control
  // over what's applied (e.g. could add per-test schema fixtures later).
  const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: { tag: string }[];
  };

  for (const entry of journal.entries) {
    const sqlPath = path.join(process.cwd(), "drizzle", `${entry.tag}.sql`);
    const sqlText = fs.readFileSync(sqlPath, "utf-8");
    // Drizzle SQL files use `--> statement-breakpoint` between statements.
    // pglite's exec() handles multi-statement input but splitting per
    // statement makes failures point at the right file:statement.
    const statements = sqlText
      .split(/--> statement-breakpoint/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        await pg.exec(stmt);
      } catch (err) {
        throw new Error(
          `Failed to apply migration ${entry.tag}: ${(err as Error).message}\n--- statement ---\n${stmt}`,
        );
      }
    }
  }

  return { db, pg, clearSeedData: () => clearSeedData(db) };
}

/**
 * Wipe all rows from every user-data table while keeping the schema.
 * Useful for tests that want predictable IDs without competing with
 * fixture inserts. Uses TRUNCATE ... RESTART IDENTITY CASCADE so
 * identity sequences restart at 1.
 */
async function clearSeedData(db: PgliteDatabase<typeof schema>): Promise<void> {
  // Order doesn't matter with CASCADE, but the explicit list documents
  // what tests consider "wipeable user data."
  const tables = [
    "metric_type_aliases",
    "metrics",
    "event_metrics",
    "workout_sets",
    "events",
    "goal_journal_entries",
    "goals",
    "focuses",
    "metric_types",
    "activities",
    "daily_summaries",
    "merge_log",
    "reconcile_log",
    "dashboard_widgets",
    "dashboards",
  ];
  // One TRUNCATE statement covers all tables; pglite handles the
  // dependency ordering via CASCADE.
  const tableList = tables.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
