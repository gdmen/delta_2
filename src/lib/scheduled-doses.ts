import { and, eq, isNotNull, sql } from "drizzle-orm";
import { metricTypes, metrics, metricScheduleSkips } from "@/db/schema";
import { db } from "@/db";
import type { AnyPgDb } from "@/db/types";
import { loadUserTimezone } from "./app-settings";
import { userScope } from "./auth/scope";

/**
 * Scheduled-dose materializer.
 *
 * A `metric_type` row with non-null `auto_log_dose` is "scheduled":
 * every local-calendar day Delta stamps one `metrics` row with that
 * dose, `source = 'scheduled'`, `source_id = 'schedule:<typeId>:<date>'`.
 * Drives medication tracking (issue #30) and any future
 * "log this thing daily" features.
 *
 * Idempotency comes from the existing `(user_id, source_id)` unique
 * index on `metrics` — concurrent calls collide on the second INSERT
 * and `ON CONFLICT DO NOTHING` keeps the table clean.
 *
 * Skip semantics: deleting a scheduled row inserts a tombstone in
 * `metric_schedule_skips (metric_type_id, skipped_date)`. The
 * materializer checks that table before inserting so deleted rows
 * don't resurrect on the next request.
 */

/**
 * In-process cache keyed by `user_id`. Value is the last local
 * calendar-date string we materialized for that user. Single-server,
 * single-process deploy (the systemd unit at scripts/deploy.sh runs
 * one Node process), so a `Map` is fine — cleared on restart, which
 * just makes the next request do the SELECT once and re-cache.
 *
 * If we ever go multi-process (PM2, multi-replica), this needs to
 * move to a shared store (Redis) or accept "first request after
 * midnight may double-check" (no correctness impact, just one extra
 * SELECT per process per day).
 */
const ensuredToday = new Map<number, string>();

/**
 * Compute "today" in the user's IANA timezone as YYYY-MM-DD. Mirrors
 * the private helper in metric-history.ts; duplicated here to keep
 * scheduled-doses standalone.
 */
function calendarDateInTz(when: Date | string, tz: string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Build the UTC ISO timestamp for "noon local on <localDate>" given the
 * user's timezone. Used for the `recorded_at` of auto-logged rows.
 *
 * Strategy: format noon-UTC of the candidate date through the user's
 * timezone, see what local hour it lands at, subtract the offset, and
 * reconstruct. Avoids a dependency on a TZ library — only uses
 * `Intl.DateTimeFormat` which is built in.
 *
 * Correctness on DST boundaries: `Intl.DateTimeFormat` returns the
 * post-shift local hour. We solve for the UTC instant that, when
 * viewed through the TZ, displays as 12:00 local. On a spring-forward
 * day this picks an unambiguous instant (12:00 local always exists
 * even when 02:00–03:00 doesn't). The few-millisecond rounding from
 * the two-step computation is fine for a "this dose was logged
 * around mid-day" stamp.
 */
function midDayInTz(localDate: string, tz: string): string {
  // Start with naive noon-UTC on the date, then adjust by the offset.
  // We compute the offset by formatting the candidate UTC instant in
  // the user's TZ and reading back the hour difference.
  const naive = new Date(`${localDate}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  });
  const localHourStr = formatter.format(naive);
  // Intl returns "24" for midnight in some locales — normalize.
  const localHour = parseInt(localHourStr, 10) % 24;
  const offsetHours = 12 - localHour; // how far to shift naive to land on noon local
  // Adjusting hours past midnight may shift the calendar day relative
  // to UTC; that's intentional — we want the UTC instant that displays
  // as 12:00 on <localDate> in the user's TZ.
  return new Date(naive.getTime() + offsetHours * 3600 * 1000).toISOString();
}

interface ScheduleRow {
  id: number;
  dose: number;
}

/**
 * Insert one auto-logged metrics row for (userId, schedule, localDate)
 * unless one already exists OR the (schedule, date) is tombstoned in
 * `metric_schedule_skips`. Idempotent: safe to call repeatedly with
 * the same args; the unique index catches duplicate inserts and the
 * skip-check catches user-deleted-then-re-materialize races.
 *
 * Used by both the daily materializer (`ensureScheduledDoses`) and the
 * one-shot backfill loop on schedule create. Same write semantics in
 * both paths so historical rows look identical to today's rows.
 */
export async function insertScheduledDoseIfMissing(
  userId: number,
  metricTypeId: number,
  dose: number,
  localDate: string,
  tz: string,
  conn: AnyPgDb = db,
): Promise<{ inserted: boolean }> {
  // Skip-table check first. If today is tombstoned for this schedule,
  // bail without writing.
  const skipRows = await conn
    .select({ x: sql<number>`1` })
    .from(metricScheduleSkips)
    .where(
      and(
        eq(metricScheduleSkips.metricTypeId, metricTypeId),
        eq(metricScheduleSkips.skippedDate, localDate),
      ),
    )
    .limit(1);
  if (skipRows.length > 0) return { inserted: false };

  const sourceId = `schedule:${metricTypeId}:${localDate}`;
  const recordedAt = midDayInTz(localDate, tz);

  // ON CONFLICT DO NOTHING uses the existing (user_id, source_id)
  // unique index. `.returning({ id })` lets us tell insert-vs-conflict
  // apart for tests / metrics, but the caller usually doesn't care.
  const result = await conn
    .insert(metrics)
    .values({
      userId,
      metricTypeId,
      value: dose,
      recordedAt,
      source: "scheduled",
      sourceId,
    })
    .onConflictDoNothing()
    .returning({ id: metrics.id });

  return { inserted: result.length > 0 };
}

/**
 * Materialize today's scheduled doses for one user. Cached so each
 * user pays at most one indexed SELECT + (rare) ≤N inserts per
 * local-calendar day. Safe to call from any request path; the cache
 * short-circuits all subsequent calls.
 *
 * Insertion point in app code: the root layout's data-loading path
 * (src/app/layout.tsx). SSR pages without medications pay ~0.05ms
 * after the first hit of the day. JSON `/api/*` routes don't hit the
 * layout so they skip this entirely.
 *
 * The `conn` parameter is for tests — production code uses the
 * singleton `db`. Always pass the same handle for both `conn` and the
 * implicit `db` ref inside `insertScheduledDoseIfMissing` (this
 * function does so automatically).
 */
export async function ensureScheduledDoses(
  userId: number,
  conn: AnyPgDb = db,
  // Tests inject a fixed "now" to make TZ math reproducible. Production
  // calls leave it default.
  now: Date = new Date(),
): Promise<{ inserted: number; checked: number }> {
  const tz = await loadUserTimezone(userId, conn);
  const localToday = calendarDateInTz(now, tz);

  if (ensuredToday.get(userId) === localToday) {
    return { inserted: 0, checked: 0 };
  }

  const schedules: ScheduleRow[] = await conn
    .select({ id: metricTypes.id, dose: metricTypes.autoLogDose })
    .from(metricTypes)
    .where(
      and(
        userScope(userId).metricTypes,
        isNotNull(metricTypes.autoLogDose),
      ),
    )
    .then((rows) =>
      rows
        .filter((r): r is { id: number; dose: number } => r.dose !== null)
        .map((r) => ({ id: r.id, dose: r.dose })),
    );

  let inserted = 0;
  for (const sched of schedules) {
    const out = await insertScheduledDoseIfMissing(
      userId,
      sched.id,
      sched.dose,
      localToday,
      tz,
      conn,
    );
    if (out.inserted) inserted++;
  }

  ensuredToday.set(userId, localToday);
  return { inserted, checked: schedules.length };
}

/**
 * Backfill scheduled doses for one schedule over a date range. Used
 * by the schedule-create endpoint when the user says "I started
 * taking this on May 6." Loops day-by-day, calls the same idempotent
 * insert as the daily materializer, so re-running with the same
 * `since` is a no-op.
 *
 * Caps the loop at `MAX_BACKFILL_DAYS` (1 year + a buffer) as a
 * sanity guard against unbounded loops from misconfigured input.
 * Caller is expected to have already validated `since` server-side
 * (within range, ≤ today); this is belt-and-suspenders.
 */
export const MAX_BACKFILL_DAYS = 400;

export async function backfillScheduledDoses(
  userId: number,
  metricTypeId: number,
  dose: number,
  since: string, // YYYY-MM-DD, inclusive
  conn: AnyPgDb = db,
  now: Date = new Date(),
): Promise<{ inserted: number; days: number }> {
  const tz = await loadUserTimezone(userId, conn);
  const localToday = calendarDateInTz(now, tz);

  // Iterate from `since` to `localToday` inclusive. Date arithmetic
  // via UTC midnight is fine because we're just walking a sequence
  // of YYYY-MM-DD strings — no time-of-day involved.
  const startMs = Date.UTC(
    parseInt(since.slice(0, 4), 10),
    parseInt(since.slice(5, 7), 10) - 1,
    parseInt(since.slice(8, 10), 10),
  );
  const endMs = Date.UTC(
    parseInt(localToday.slice(0, 4), 10),
    parseInt(localToday.slice(5, 7), 10) - 1,
    parseInt(localToday.slice(8, 10), 10),
  );
  const dayMs = 24 * 3600 * 1000;
  const days = Math.floor((endMs - startMs) / dayMs) + 1;

  if (days > MAX_BACKFILL_DAYS) {
    throw new Error(
      `Backfill range too large: ${days} days exceeds cap of ${MAX_BACKFILL_DAYS}`,
    );
  }
  if (days <= 0) {
    return { inserted: 0, days: 0 };
  }

  let inserted = 0;
  for (let i = 0; i < days; i++) {
    const dateMs = startMs + i * dayMs;
    const d = new Date(dateMs);
    const localDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const out = await insertScheduledDoseIfMissing(
      userId,
      metricTypeId,
      dose,
      localDate,
      tz,
      conn,
    );
    if (out.inserted) inserted++;
  }

  // Bump the per-process cache so the next ensureScheduledDoses call
  // for this user doesn't redundantly try to insert today's row.
  ensuredToday.set(userId, localToday);

  return { inserted, days };
}

/**
 * Test-only escape hatch to reset the cache between cases. Production
 * code shouldn't need this — the cache is self-managing.
 */
export function _resetEnsuredCache(): void {
  ensuredToday.clear();
}
