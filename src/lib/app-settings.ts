import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { AnyPgDb } from "@/db/types";

/**
 * Read the user's preferred timezone (IANA name). Returns the JS
 * runtime's resolved TZ as a fallback when the row is missing or
 * `timezone` is null — keeps reads branchless for callers that want a
 * non-null string.
 *
 * Used by metric-history's daily-aggregate filter to compute the user's
 * "today". On a UTC server serving a PDT user, server-local time is
 * hours off; without this, today's mid-flight value bleeds through the
 * 7-day window between 17:00 and 24:00 PDT.
 *
 * The `conn` parameter is for tests — production code uses the
 * singleton `db`. Same pattern as `recomputeDailySummary` etc.
 */
export async function loadUserTimezone(
  userId: number,
  conn: AnyPgDb = db,
): Promise<string> {
  const row = await conn
    .select({ tz: appSettings.timezone })
    .from(appSettings)
    .where(eq(appSettings.userId, userId))
    .limit(1);
  return row[0]?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Set the user's preferred timezone. Pass null to clear it (falls back
 * to the runtime default on read). Caller is responsible for validating
 * the IANA name against `Intl.supportedValuesOf("timeZone")` before
 * writing — bad strings reach the formatter and throw at render time.
 *
 * Upsert pattern: try update; if no row exists, insert. Per-user PK
 * means each user gets at most one settings row.
 */
export async function saveUserTimezone(
  timezone: string | null,
  userId: number,
): Promise<void> {
  const result = await db
    .update(appSettings)
    .set({ timezone })
    .where(eq(appSettings.userId, userId))
    .returning({ userId: appSettings.userId });
  if (result.length === 0) {
    await db.insert(appSettings).values({ userId, timezone });
  }
}
