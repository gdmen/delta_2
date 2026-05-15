import { db } from "@/db";
import { events, metricTypes, sports, workoutSets } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { oconnorE1RM } from "./strength-metrics";
import { userScope } from "./auth/scope";

/**
 * Auto-computed metric_types: their values are derived at read time from
 * underlying tables (events, workout_sets) rather than recorded. The
 * metric_types row exists for catalog/discovery and so goals can FK to
 * it; the `metrics` table holds nothing for these names.
 *
 * The resolver pattern-matches the metric name and dispatches to a
 * per-family computer that returns the Series shape the rest of the app
 * already consumes (charts, goal-calc, dashboard widgets). When the name
 * doesn't match any computed family the resolver returns null and the
 * caller falls through to the primitive + workout_sets-fanout path in
 * metric-history.ts.
 *
 * Six families today:
 *   sport_sessions_count_<sport>   one sample per active day, value = count(events)
 *   sport_minutes_<sport>          one sample per active day, value = sum(duration_minutes)
 *   <exercise>_max                 lifetime PR step-up (monotonic, only emits on new max)
 *   <exercise>_max_12mo            sliding 365-day max (steps both up and down)
 *   <exercise>_e1rm                per-day max O'Conner e1RM
 *   <exercise>_volume_per_day      per-day sum(weight × reps)
 *
 * Read-time only — same compromise as the per-rep workout_sets fanout in
 * metric-history.ts. Migration to materialized rows looks the same: point
 * the resolver at INSERT instead of returning the array, add app-layer
 * sync at the write entry points, swap the read-time dispatch for a plain
 * SELECT. Until that's actually needed, computed-at-read is simpler.
 */

type Sample = { date: string; value: number };

interface ComputedMatch {
  family:
    | "sport_sessions_count"
    | "sport_minutes"
    | "exercise_max"
    | "exercise_max_12mo"
    | "exercise_e1rm"
    | "exercise_volume_per_day";
  subject: string; // sport name or exercise slug
}

/**
 * Pattern-match the metric name into one of the six families. Order
 * matters: longer suffixes (`_max_12mo`) must beat shorter ones (`_max`).
 */
export function matchComputed(name: string): ComputedMatch | null {
  if (name.startsWith("sport_sessions_count_")) {
    return { family: "sport_sessions_count", subject: name.slice("sport_sessions_count_".length) };
  }
  if (name.startsWith("sport_minutes_")) {
    return { family: "sport_minutes", subject: name.slice("sport_minutes_".length) };
  }
  if (name.endsWith("_max_12mo")) {
    return { family: "exercise_max_12mo", subject: name.slice(0, -"_max_12mo".length) };
  }
  if (name.endsWith("_volume_per_day")) {
    return { family: "exercise_volume_per_day", subject: name.slice(0, -"_volume_per_day".length) };
  }
  if (name.endsWith("_e1rm")) {
    return { family: "exercise_e1rm", subject: name.slice(0, -"_e1rm".length) };
  }
  if (name.endsWith("_max")) {
    return { family: "exercise_max", subject: name.slice(0, -"_max".length) };
  }
  return null;
}

/**
 * Resolve a metric name to a Series via computation, or null if the name
 * isn't computed. The caller (metric-history) supplies the metric_types
 * row for unit/target/higherIsBetter — we just produce the samples.
 */
export async function resolveComputedSamples(name: string, userId: number): Promise<Sample[] | null> {
  const m = matchComputed(name);
  if (!m) return null;

  switch (m.family) {
    case "sport_sessions_count":
      return await sportSessionsCount(m.subject, userId);
    case "sport_minutes":
      return await sportMinutes(m.subject, userId);
    case "exercise_max":
      return await exerciseLifetimeMax(m.subject, userId);
    case "exercise_max_12mo":
      return await exerciseTrailingMax(m.subject, 365, userId);
    case "exercise_e1rm":
      return await exerciseE1rmDailyMax(m.subject, userId);
    case "exercise_volume_per_day":
      return await exerciseVolumePerDay(m.subject, userId);
  }
}

/**
 * Return the row count this metric would produce, without computing the
 * full Series. Used by the /data Metrics tab so computed types report
 * truthful counts in the table column.
 *
 * Returns null when the name isn't computed (caller falls through to the
 * stored + synthesized count path).
 */
export async function countForComputed(name: string, userId: number): Promise<number | null> {
  const m = matchComputed(name);
  if (!m) return null;
  // Counts are bounded by underlying-row counts, so the cheapest way is
  // just to compute the Series and return its length. At current scale
  // (≤ a few thousand rows max per metric) this is fine. If the /data
  // page ever feels slow we can add per-family count shortcuts.
  const samples = await resolveComputedSamples(name, userId);
  return samples?.length ?? 0;
}

// -----------------------------------------------------------------------------
// Sport families
// -----------------------------------------------------------------------------

async function loadSportId(sportName: string, userId: number): Promise<number | null> {
  const rows = await db
    .select({ id: sports.id })
    .from(sports)
    .where(and(userScope(userId).sports, eq(sports.name, sportName)))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function sportSessionsCount(sportName: string, userId: number): Promise<Sample[]> {
  const sportId = await loadSportId(sportName, userId);
  if (sportId === null) return [];
  // Group by calendar date in the started_at string. substr is cheaper
  // here than parsing — recordedAt is always ISO 8601 prefixed by
  // YYYY-MM-DD.
  const rows = await db
    .select({
      day: sql<string>`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`,
      n: sql<number>`count(*)`,
    })
    .from(events)
    .where(and(userScope(userId).events, eq(events.sportId, sportId)))
    .groupBy(sql`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`);
  return rows.map((r) => ({ date: r.day, value: Number(r.n) }));
}

async function sportMinutes(sportName: string, userId: number): Promise<Sample[]> {
  const sportId = await loadSportId(sportName, userId);
  if (sportId === null) return [];
  const rows = await db
    .select({
      day: sql<string>`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`,
      mins: sql<number>`coalesce(sum(${events.durationMinutes}), 0)`,
    })
    .from(events)
    .where(and(userScope(userId).events, eq(events.sportId, sportId)))
    .groupBy(sql`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`);
  // Drop days where the sum is 0 (events with NULL duration sum to 0). A
  // user reading the chart wants days that actually represent training.
  return rows
    .filter((r) => Number(r.mins) > 0)
    .map((r) => ({ date: r.day, value: Number(r.mins) }));
}

// -----------------------------------------------------------------------------
// Exercise families
// -----------------------------------------------------------------------------

/**
 * Resolve an exercise slug back to a metric_types.id. The slug is the
 * lowercased, snake_cased exercise name (see slugifyExercise in seed.ts).
 * We compute the same slug for every metric_types row and match — there's
 * no stored slug column. With ~150 exercise rows this is fine; upgrade to
 * a stored slug or a slug-keyed index when the catalog gets large.
 */
async function loadExerciseId(slug: string, userId: number): Promise<number | null> {
  const rows = await db
    .select({ id: metricTypes.id, name: metricTypes.name })
    .from(metricTypes)
    .where(userScope(userId).metricTypes);
  for (const r of rows) {
    if (slugifyExercise(r.name) === slug) return r.id;
  }
  return null;
}

/** Slug shared with seed.ts. Lowercase + replace non-alphanumerics with `_`. */
export function slugifyExercise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface SetRow {
  weight: number;
  reps: number;
  startedAt: string;
}

async function loadSetsForExercise(metricTypeId: number, userId: number): Promise<SetRow[]> {
  return db
    .select({
      weight: workoutSets.weight,
      reps: workoutSets.reps,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .where(
      and(
        userScope(userId).events,
        eq(workoutSets.exerciseMetricTypeId, metricTypeId),
      ),
    )
    .orderBy(events.startedAt);
}

/**
 * Collapse sets to one entry per calendar day, keeping the day's max
 * weight (and a representative timestamp from that max set so charts
 * still place the dot on the right calendar position). Used as the
 * per-day input for both lifetime and trailing-window max so a single
 * session that ramps weight (e.g. 135 → 185 → 225) yields one sample
 * for the day at 225 instead of three step-up samples on the same date.
 */
function collapseSetsToDailyMax(
  sets: SetRow[],
): Array<{ startedAt: string; weight: number }> {
  const byDay = new Map<string, { startedAt: string; weight: number }>();
  for (const s of sets) {
    const day = s.startedAt.slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || s.weight > existing.weight) {
      byDay.set(day, { startedAt: s.startedAt, weight: s.weight });
    }
  }
  return [...byDay.values()].sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  );
}

async function exerciseLifetimeMax(slug: string, userId: number): Promise<Sample[]> {
  const id = await loadExerciseId(slug, userId);
  if (id === null) return [];
  const sets = await loadSetsForExercise(id, userId);
  // Day-collapse first so a session that warms up through several sub-PRs
  // (e.g. 135 → 185 → 225 → 245) emits at most one sample for that day.
  const daily = collapseSetsToDailyMax(sets);
  const out: Sample[] = [];
  let runningMax = -Infinity;
  for (const d of daily) {
    if (d.weight > runningMax) {
      runningMax = d.weight;
      out.push({ date: d.startedAt, value: d.weight });
    }
  }
  return out;
}

/**
 * Sliding-window max via a monotonic deque, keyed on day-collapsed sets.
 * Each day advances time by its representative timestamp; we evict deque
 * entries older than `windowDays` and pop entries less than the current
 * day's max off the back so the deque front is always the window max.
 * Emit one sample per active day with the current windowed max, then
 * collapse consecutive equal-value samples to keep the chart sparse.
 */
async function exerciseTrailingMax(slug: string, windowDays: number, userId: number): Promise<Sample[]> {
  const id = await loadExerciseId(slug, userId);
  if (id === null) return [];
  const sets = await loadSetsForExercise(id, userId);
  const daily = collapseSetsToDailyMax(sets);
  if (daily.length === 0) return [];
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const deque: Array<{ startedAt: string; weight: number }> = [];
  const samples: Sample[] = [];
  for (const d of daily) {
    const t = new Date(d.startedAt).getTime();
    while (deque.length > 0 && new Date(deque[0].startedAt).getTime() < t - windowMs) {
      deque.shift();
    }
    while (deque.length > 0 && deque[deque.length - 1].weight < d.weight) {
      deque.pop();
    }
    deque.push(d);
    samples.push({ date: d.startedAt, value: deque[0].weight });
  }
  const collapsed: Sample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    const prev = collapsed[collapsed.length - 1];
    if (!prev || prev.value !== cur.value || i === samples.length - 1) {
      collapsed.push(cur);
    }
  }
  return collapsed;
}

async function exerciseE1rmDailyMax(slug: string, userId: number): Promise<Sample[]> {
  const id = await loadExerciseId(slug, userId);
  if (id === null) return [];
  const sets = await loadSetsForExercise(id, userId);
  // Group by calendar day of started_at; max e1RM across the day's sets.
  const byDay = new Map<string, { date: string; maxE1: number }>();
  for (const s of sets) {
    const day = s.startedAt.slice(0, 10);
    const e1 = oconnorE1RM(s.weight, s.reps);
    if (e1 <= 0) continue;
    const existing = byDay.get(day);
    if (!existing || e1 > existing.maxE1) {
      byDay.set(day, { date: s.startedAt, maxE1: e1 });
    }
  }
  return [...byDay.values()]
    .map((d) => ({ date: d.date, value: Math.round(d.maxE1 * 10) / 10 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function exerciseVolumePerDay(slug: string, userId: number): Promise<Sample[]> {
  const id = await loadExerciseId(slug, userId);
  if (id === null) return [];
  const rows = await db
    .select({
      day: sql<string>`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`,
      vol: sql<number>`coalesce(sum(${workoutSets.weight} * ${workoutSets.reps}), 0)`,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .where(
      and(
        userScope(userId).events,
        eq(workoutSets.exerciseMetricTypeId, id),
      ),
    )
    .groupBy(sql`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char((${events.startedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`);
  return rows
    .filter((r) => Number(r.vol) > 0)
    .map((r) => ({ date: r.day, value: Number(r.vol) }));
}

// -----------------------------------------------------------------------------
// Source description (for the /data/metrics/<name> read-only banner)
// -----------------------------------------------------------------------------

export function describeComputedSource(name: string): string | null {
  const m = matchComputed(name);
  if (!m) return null;
  switch (m.family) {
    case "sport_sessions_count":
      return `count of events for sport "${m.subject}", grouped by day`;
    case "sport_minutes":
      return `sum of duration_minutes for sport "${m.subject}", grouped by day`;
    case "exercise_max":
      return `lifetime PR walk over workout_sets where exercise = "${m.subject}"`;
    case "exercise_max_12mo":
      return `trailing 365-day max over workout_sets where exercise = "${m.subject}"`;
    case "exercise_e1rm":
      return `per-day max O'Conner e1RM over workout_sets where exercise = "${m.subject}"`;
    case "exercise_volume_per_day":
      return `per-day sum(weight × reps) over workout_sets where exercise = "${m.subject}"`;
  }
}
