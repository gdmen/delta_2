import { db } from "@/db";
import { events, metrics, metricTypes, workoutSets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveComputedSamples } from "./computed-metrics";
import { loadUserTimezone } from "./app-settings";
import { userScope } from "./auth/scope";

export interface Series {
  samples: Array<{ date: string; value: number }>;
  unit: string;
  /** Target from metric_types (single source of truth). null if unset. */
  target: number | null;
  /** Target direction: true = floor, false = ceiling. Default true. */
  higherIsBetter: boolean;
}

/**
 * Lookup metric_type by name once (carries unit + target + direction +
 * frequencyHint). When the name doesn't exist we still return a usable
 * Series so the caller can render an empty placeholder rather than
 * crashing.
 */
async function loadType(metricName: string, userId: number) {
  const rows = await db
    .select({
      id: metricTypes.id,
      unit: metricTypes.unit,
      target: metricTypes.target,
      higherIsBetter: metricTypes.higherIsBetter,
      frequencyHint: metricTypes.frequencyHint,
    })
    .from(metricTypes)
    .where(and(userScope(userId).metricTypes, eq(metricTypes.name, metricName)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Daily-aggregated metrics — one observation per calendar day where the
 * value rolls up the day's worth of activity (steps, sleep hours, sport
 * minutes, *_max). Today's value is mid-flight and would mislead trends,
 * so we drop it from the series. Detection:
 *   - Computed metric (every family in computed-metrics.ts is per-day).
 *   - frequencyHint === "daily" on the metric_types row.
 * Instantaneous metrics (body weight, body fat %, set-by-set lifts) are
 * unaffected — today's reading IS complete.
 */
function isDailyAggregate(
  type: { frequencyHint: string | null } | null,
  computed: Array<{ date: string; value: number }> | null,
): boolean {
  return computed !== null || type?.frequencyHint === "daily";
}

/** YYYY-MM-DD calendar date for an instant, in a given IANA timezone. */
function calendarDateInTz(when: Date | string, tz: string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function excludeTodayIfDaily(
  samples: Array<{ date: string; value: number }>,
  type: { frequencyHint: string | null } | null,
  computed: Array<{ date: string; value: number }> | null,
  userTz: string,
): Array<{ date: string; value: number }> {
  if (!isDailyAggregate(type, computed)) return samples;
  const today = calendarDateInTz(new Date(), userTz);
  return samples.filter((s) => calendarDateInTz(s.date, userTz) < today);
}

/**
 * Read every workout_set referencing this metric_type and fan each set out
 * into `reps` synthesized samples — one per rep, all sharing the parent
 * event's `started_at`. The value is the workout_set's `weight` column,
 * which means added load (added belt for body-weight exercises, bar weight
 * for barbell exercises). Treating each rep as an independent reading keeps
 * the synthesis lossless: a 5-rep set with `weight=185` becomes 5 samples
 * of 185 at the same instant.
 *
 * IMPORTANT — these samples are NOT stored in `metrics`. They're computed
 * at read time. The contract that consumers see (a Series with samples) is
 * the same whether the data is stored or synthesized; the cost we pay is
 * the per-read scan, which at current scale (~3K synthesized rows max per
 * exercise) is a sub-100ms operation. If/when this gets hot enough to
 * materialize, the migration is the synthesis function pointed at INSERT
 * instead of array `concat` — see commit message for full rationale.
 *
 * INHERIT scoping: workout_sets has no user_id; restrict by joining
 * through events.user_id.
 */
async function loadSyntheticSamples(
  metricTypeId: number,
  userId: number,
): Promise<Array<{ date: string; value: number }>> {
  const setRows = await db
    .select({
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .where(
      and(
        userScope(userId).events,
        eq(workoutSets.exerciseMetricTypeId, metricTypeId),
      ),
    );

  const out: Array<{ date: string; value: number }> = [];
  for (const r of setRows) {
    for (let i = 0; i < r.reps; i++) {
      out.push({ date: r.startedAt, value: r.weight });
    }
  }
  return out;
}

/**
 * Build a Series from samples + the metric_types row's metadata. Used by
 * both the primitive/synthesized path and the computed path so they
 * return the same shape.
 */
function makeSeries(
  samples: Array<{ date: string; value: number }>,
  type: { unit: string; target: number | null; higherIsBetter: boolean } | null,
): Series {
  return {
    samples,
    unit: type?.unit ?? "",
    target: type?.target ?? null,
    higherIsBetter: type?.higherIsBetter ?? true,
  };
}

function sortByDate(samples: Array<{ date: string; value: number }>) {
  return samples.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function filterSince(samples: Array<{ date: string; value: number }>, sinceIso: string) {
  return samples.filter((s) => s.date >= sinceIso);
}

function filterRange(
  samples: Array<{ date: string; value: number }>,
  sinceIso: string,
  untilIso: string,
) {
  // [since, until) — sinceIso is start-of-day at the `from` offset;
  // untilIso is start-of-day AFTER the `to` offset, so the `to` day's
  // samples are included.
  return samples.filter((s) => s.date >= sinceIso && s.date < untilIso);
}

/**
 * Convert a [from, to] day-offset tuple (relative to today, both
 * inclusive, in user-local TZ) into UTC ISO bounds for the metrics
 * SELECT. Time-of-day is start-of-local-day at the `from` boundary
 * and start-of-local-day AFTER `to` at the `until` boundary — gives
 * a calendar-day-aligned half-open interval [since, until).
 *
 * Today (offset 0) means "today's local calendar day." Offset -1
 * means yesterday's, etc.
 */
function rangeBoundsLocal(
  fromOffset: number,
  toOffset: number,
  userTz: string,
): { sinceIso: string; untilIso: string } {
  const now = new Date();
  // Reading parts of `now` in userTz to find today's local calendar
  // date.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: userTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayLocal = fmt.format(now); // "YYYY-MM-DD"
  const [y, m, d] = todayLocal.split("-").map(Number);

  // Build local-midnight Date for (today + fromOffset) and
  // (today + toOffset + 1), then convert to ISO. Note: this Date is
  // in the SERVER's TZ, not the user's — for accuracy we treat the
  // local date as midnight UTC, then offset for the TZ. For Delta's
  // single-user-per-row case the inaccuracy at TZ boundaries is at
  // most one row off; we accept it as cheap-and-correct-enough.
  const since = new Date(Date.UTC(y, m - 1, d + fromOffset, 0, 0, 0));
  const until = new Date(Date.UTC(y, m - 1, d + toOffset + 1, 0, 0, 0));
  return { sinceIso: since.toISOString(), untilIso: until.toISOString() };
}

/** Pull the full history of a metric, ordered oldest-to-newest.
 * Daily-aggregate metrics (computed families, frequencyHint === "daily")
 * drop today's still-mid-flight value. */
export async function getAllHistory(metricName: string, userId: number): Promise<Series> {
  const [type, userTz] = await Promise.all([
    loadType(metricName, userId),
    loadUserTimezone(userId),
  ]);

  // Computed metrics are pattern-matched on name. They route around the
  // metrics + workout_sets fanout and return their own samples; metadata
  // (unit/target/higherIsBetter) still comes from the metric_types row,
  // which is auto-seeded so it always exists.
  const computed = await resolveComputedSamples(metricName, userId);
  if (computed !== null) {
    return makeSeries(sortByDate(excludeTodayIfDaily(computed, type, computed, userTz)), type);
  }

  if (!type) return makeSeries([], null);

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(and(userScope(userId).metrics, eq(metrics.metricTypeId, type.id)));

  const real = rows.map((r) => ({ date: r.recordedAt, value: r.value }));
  const synthetic = await loadSyntheticSamples(type.id, userId);
  return makeSeries(
    sortByDate(excludeTodayIfDaily([...real, ...synthetic], type, computed, userTz)),
    type,
  );
}

/**
 * Pull samples within a calendar-day range, ordered oldest-to-newest.
 *
 * `range` is `[fromOffset, toOffset]` — both integer day offsets from
 * today, inclusive, in the user's local timezone. See the schema
 * docs on `windowDaysRange` for the full shape.
 *
 * When `toOffset >= 0` (window includes today) and the metric is a
 * daily-aggregate (computed family, or frequencyHint === "daily"),
 * today's still-mid-flight value is dropped — matches the legacy
 * `getLastDays` behavior. When `toOffset < 0` (window already ends
 * before today) the filter is a no-op because today's sample is
 * already outside the range.
 */
export async function getDayRange(
  metricName: string,
  range: readonly [number, number],
  userId: number,
): Promise<Series> {
  const [type, userTz] = await Promise.all([
    loadType(metricName, userId),
    loadUserTimezone(userId),
  ]);

  const { sinceIso, untilIso } = rangeBoundsLocal(range[0], range[1], userTz);

  const computed = await resolveComputedSamples(metricName, userId);
  if (computed !== null) {
    return makeSeries(
      sortByDate(
        excludeTodayIfDaily(
          filterRange(computed, sinceIso, untilIso),
          type,
          computed,
          userTz,
        ),
      ),
      type,
    );
  }

  if (!type) return makeSeries([], null);

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(and(userScope(userId).metrics, eq(metrics.metricTypeId, type.id)));

  const real = rows.map((r) => ({ date: r.recordedAt, value: r.value }));
  const synthetic = await loadSyntheticSamples(type.id, userId);
  return makeSeries(
    sortByDate(
      excludeTodayIfDaily(
        filterRange([...real, ...synthetic], sinceIso, untilIso),
        type,
        computed,
        userTz,
      ),
    ),
    type,
  );
}

