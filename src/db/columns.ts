import { customType } from "drizzle-orm/pg-core";

/**
 * ISO-8601 timestamptz column for the codebase's text→timestamptz
 * migration (issue #25).
 *
 * Wire shape:
 *   Postgres storage: `timestamptz` (correct temporal semantics, indexable).
 *   JS contract:      `string` in `new Date().toISOString()` format —
 *                     `2026-05-14T12:00:00.000Z` (T separator, 3-digit ms,
 *                     `Z` suffix).
 *
 * Why a wrapper instead of Drizzle's built-in `timestamp({ mode: ... })`:
 * the codebase has ~60 consumer sites doing `.slice(0, 10)`,
 * `.split('T')[0]`, string equality, and other operations that assume
 * the read value is a `toISOString()`-shaped string. Returning a JS
 * `Date` (Drizzle's default `mode: "date"`) or Postgres's canonical
 * `2026-05-14 12:00:00+00` string (`mode: "string"`) breaks those sites.
 * The wrapper preserves the existing contract while letting Postgres do
 * temporal math correctly.
 *
 * Driver behavior:
 * - **postgres-js** (production) parses Postgres OID 1184 (`timestamptz`)
 *   into a JS `Date` by default. `fromDriver` receives a `Date`, calls
 *   `.toISOString()`, returns the canonical 3-digit-ms `Z`-suffixed
 *   string.
 * - **pglite** (tests, via `drizzle-orm/pglite`) returns a string in
 *   Postgres's canonical format. `fromDriver` re-parses through `new
 *   Date(s).toISOString()` to land on the same canonical form.
 *
 * Both paths produce identical output regardless of driver — the
 * format-precision contract is upheld by always routing through
 * `new Date(...).toISOString()` at the boundary.
 *
 * Sub-second precision: input `2026-05-14T12:00:00.123Z` (3-digit ms)
 * stores as microsecond timestamptz `12:00:00.123000+00` and reads back
 * as `12:00:00.123Z`. Input with microsecond precision would truncate
 * on the read-back. Inputs from `new Date().toISOString()` are 3-digit
 * by construction, so this is a no-op for the dominant path.
 */
export const isoTimestamptz = customType<{
  data: string;
  driverData: Date | string;
}>({
  dataType() {
    return "timestamptz";
  },
  toDriver(value: string): string {
    // Postgres accepts ISO-8601 strings of any offset shape and parses
    // them to timestamptz. No client-side reformatting needed.
    return value;
  },
  fromDriver(value: Date | string): string {
    // Normalize whatever the driver hands us back to the canonical
    // `new Date().toISOString()` format.
    if (value instanceof Date) return value.toISOString();
    return new Date(value).toISOString();
  },
});
