import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import path from "node:path";
import * as schema from "./schema";

// Lazy connection — opening the postgres-js client is deferred until
// first use so that test files (which substitute pglite via the optional
// last-arg pattern) can import `db` without exploding at module-load
// time when DATABASE_URL is unset. The Proxy below routes any property
// access to a singleton `realDb` that's created on demand.

let realClient: Sql | null = null;
let realDb: PostgresJsDatabase<typeof schema> | null = null;

function ensureDb(): PostgresJsDatabase<typeof schema> {
  if (realDb) return realDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Example: postgresql://delta@localhost:5432/delta_dev",
    );
  }
  // Pool size: 10 is plenty for Delta's traffic (single-instance, ~20 users).
  // Bumping later if a dashboard renders many parallel widget queries — but
  // tune by p99 wait time, not by feel.
  realClient = postgres(url, { max: 10 });
  realDb = drizzle(realClient, { schema });
  return realDb;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const inner = ensureDb();
    const value = Reflect.get(inner, prop, receiver);
    return typeof value === "function" ? value.bind(inner) : value;
  },
});

// Auto-apply pending migrations in dev so a fresh `git pull` + `npm run dev`
// works without an explicit `npx drizzle-kit migrate`. Production deploys
// run migrations through scripts/deploy.sh — keep app stopped while
// drizzle-kit migrate runs to avoid surprising mid-flight schema changes.
//
// Migrations are idempotent (drizzle tracks applied ones via the
// `__drizzle_migrations` meta table), so this is a no-op on subsequent boots.
if (process.env.NODE_ENV !== "production" && process.env.DATABASE_URL) {
  // postgres-js's migrator uses a separate single-connection pool. We can't
  // reuse the app's pool (the migrator wants its own).
  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  migrate(migrationDb, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  })
    .catch((err) => {
      // Don't crash dev on migration failure — surface a loud warning so the
      // dev sees what happened. Schema mismatches will still error cleanly at
      // the first query that hits the missing column.
      console.error(
        "[db] migrate() failed at startup. Run `npx drizzle-kit migrate` manually.",
        err,
      );
    })
    .finally(() => migrationClient.end({ timeout: 5 }));
}
