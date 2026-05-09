/**
 * Common Postgres-flavor Drizzle types shared across drivers.
 *
 * Production runs on `postgres-js` via `drizzle-orm/postgres-js`; tests run
 * on `pglite` (in-process WASM Postgres) via `drizzle-orm/pglite`. Both
 * drivers extend the same `PgDatabase` / `PgTransaction` base classes from
 * `drizzle-orm/pg-core`. Functions that accept "a drizzle handle for our
 * schema" should type their parameter as `AnyPgDb` (or `AnyPgTx` inside a
 * transaction) so they accept either driver without an HKT mismatch error.
 *
 * The `any` query-result HKT is a deliberate type-level widening — the
 * concrete result type depends on the driver, and the schemas-and-shapes
 * are what we actually care about for type safety in our code.
 */

import type { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type * as schema from "./schema";

export type AnyPgDb = PgDatabase<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type AnyPgTx = PgTransaction<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
