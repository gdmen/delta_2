import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import path from "node:path";
import * as schema from "./schema";

const sqlite = new Database("delta2.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// Auto-apply pending migrations in dev so a fresh `git pull` + `npm run dev`
// works without an explicit `npx drizzle-kit migrate`. Production deploys
// run migrations through scripts/deploy.sh — see the comment there about
// the WAL write-lock that makes drizzle-kit migrate hang silently when the
// app is already holding the file. Skipping in prod avoids that race.
//
// Migrations are idempotent (drizzle tracks applied ones via the
// `__drizzle_migrations` meta table), so this is a no-op on subsequent
// boots.
if (process.env.NODE_ENV !== "production") {
  try {
    migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  } catch (err) {
    // Don't crash dev on migration failure — surface a loud warning so
    // the dev sees what happened. Schema mismatches will still error
    // cleanly at the first query that hits the missing column.
    console.error(
      "[db] migrate() failed at startup. Run `npx drizzle-kit migrate` manually.",
      err,
    );
  }
}
