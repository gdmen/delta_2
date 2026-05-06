import { db } from "@/db";
import { appSettings } from "@/db/schema";

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
 */
export async function loadUserTimezone(): Promise<string> {
  const row = await db
    .select({ tz: appSettings.timezone })
    .from(appSettings)
    .limit(1);
  return row[0]?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Set the user's preferred timezone. Pass null to clear it (falls back
 * to the runtime default on read). Caller is responsible for validating
 * the IANA name against `Intl.supportedValuesOf("timeZone")` before
 * writing — bad strings reach the formatter and throw at render time.
 */
export async function saveUserTimezone(timezone: string | null): Promise<void> {
  // Single-row table (id=1), inserted by migration 0022. Use update; if
  // the row is somehow missing, fall back to insert with the seeded id.
  const result = await db
    .update(appSettings)
    .set({ timezone })
    .returning({ id: appSettings.id });
  if (result.length === 0) {
    await db.insert(appSettings).values({ id: 1, timezone });
  }
}
