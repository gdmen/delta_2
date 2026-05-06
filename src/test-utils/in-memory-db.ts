import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@/db/schema";
import fs from "node:fs";
import path from "node:path";

/**
 * Build a fresh in-memory SQLite database with all migrations applied,
 * keyed by the drizzle journal so tests run against the same schema as
 * production. The instance is isolated per call — call this in `beforeEach`
 * if you want a clean slate every test.
 *
 * Returns the drizzle handle (typed identical to the prod `db` import) and
 * the underlying better-sqlite3 instance for raw SQL when needed.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = MEMORY");
  sqlite.pragma("foreign_keys = ON");

  const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: { tag: string }[];
  };

  for (const entry of journal.entries) {
    const sqlPath = path.join(process.cwd(), "drizzle", `${entry.tag}.sql`);
    const sql = fs.readFileSync(sqlPath, "utf-8");
    // Drizzle SQL files use `--> statement-breakpoint` between statements.
    // better-sqlite3.exec() handles multiple statements; the breakpoint
    // comments are SQL comments and are ignored, but splitting and
    // running each segment separately makes failures point at the right
    // file:statement.
    const statements = sql
      .split(/--> statement-breakpoint/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        sqlite.exec(stmt);
      } catch (err) {
        throw new Error(
          `Failed to apply migration ${entry.tag}: ${(err as Error).message}\n--- statement ---\n${stmt}`,
        );
      }
    }
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, clearSeedData: () => clearSeedData(sqlite) };
}

/**
 * Wipe all rows from every user-data table while keeping the schema.
 * Useful for tests that want predictable IDs without competing with
 * seed migrations (0006_redundant_bullseye and friends auto-insert
 * canonical metric_types/sports starting at id=1).
 */
function clearSeedData(sqlite: Database.Database): void {
  sqlite.pragma("foreign_keys = OFF");
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
    "sports",
    "daily_summaries",
    "merge_log",
    "sqlite_sequence",
  ];
  for (const t of tables) {
    try {
      sqlite.exec(`DELETE FROM "${t}"`);
    } catch {
      // Table may not exist in older snapshots; ignore.
    }
  }
  sqlite.pragma("foreign_keys = ON");
}

export type TestDb = ReturnType<typeof createTestDb>["db"];
