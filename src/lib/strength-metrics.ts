import { db } from "@/db";
import { workoutSets, events, sports, metricTypes } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import {
  BIG_THREE_DEFAULT_NAMES,
  type Lift,
  type LiftNames,
} from "./strength-metrics-defaults";

export {
  BIG_THREE_DEFAULT_NAMES,
  type Lift,
  type LiftNames,
} from "./strength-metrics-defaults";

/**
 * Big-3 stats for the powerlifting page. Derives everything from
 * workout_sets on read - no schema, no ingest-time aggregation. Formula is
 * O'Conner: e1RM = weight * (1 + 0.025 * reps). Reps > 10 skipped (formula
 * degrades). All-time PR is the heaviest actual 1-rep set, not e1RM.
 */

export interface LiftTopSet {
  date: string;        // ISO
  weight: number;
  reps: number;
  rpe: number | null;
  e1rm: number;        // rounded
}

export interface LiftPR1RM {
  date: string;
  weight: number;
}

export interface LiftStats {
  lift: Lift;
  /** Most-recent-session max e1RM, or null if no sets. */
  currentE1RM: number | null;
  /** Heaviest-e1RM set of the most recent session that had this lift. */
  topSet: LiftTopSet | null;
  /** Heaviest actual 1-rep set ever. null if the user has never done a true single. */
  pr1RM: LiftPR1RM | null;
  /** One point per session: (date, max e1RM for that session). Ascending. */
  history: { date: string; e1rm: number }[];
}

// -----------------------------------------------------------------------------
// Lift classification
// -----------------------------------------------------------------------------

/**
 * Returns the lift slot whose configured exercise name matches
 * `exerciseName` exactly (case-insensitive, trimmed). Returns null when
 * the name doesn't match any of the three configured lifts — the
 * caller's job is to drop that row from big-3 stats. Substring fuzzing
 * was removed so users get exactly the lift they pick: no surprise
 * inclusion of `Barbell Front Squat` in the squat slot, no exclusion
 * list to maintain.
 */
export function classifyLift(
  exerciseName: string,
  names: LiftNames = BIG_THREE_DEFAULT_NAMES,
): Lift | null {
  const lower = exerciseName.trim().toLowerCase();
  if (!lower) return null;
  if (lower === names.squat.trim().toLowerCase()) return "squat";
  if (lower === names.bench.trim().toLowerCase()) return "bench";
  if (lower === names.deadlift.trim().toLowerCase()) return "deadlift";
  return null;
}

// -----------------------------------------------------------------------------
// O'Conner e1RM
// -----------------------------------------------------------------------------

export function oconnorE1RM(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return 0;
  if (weight <= 0 || reps <= 0 || reps > 10) return 0;
  if (reps === 1) return weight;
  return weight * (1 + 0.025 * reps);
}

// -----------------------------------------------------------------------------
// Aggregate
// -----------------------------------------------------------------------------

export interface BigThreeStats {
  /** Sport color (hex). Falls back to a neutral muted gray when no
   * powerlifting sport row exists yet. */
  color: string;
  lifts: Record<Lift, LiftStats>;
}

const FALLBACK_COLOR = "#737373"; // neutral-500 — used when sport row missing

/**
 * Returns stats for all three lifts plus a display color. Reads
 * workout_sets via the configured metric_type names — sport-agnostic,
 * so a bench press done in a BJJ session (or any other sport) still
 * counts. Safe when no matching workout_sets exist.
 *
 * `names` lets callers override the canonical exercise name per slot
 * (squat/bench/deadlift). Defaults to BIG_THREE_DEFAULT_NAMES.
 *
 * Color picks up `sports.color` from the first matched metric_type's
 * sport_id; falls back to neutral when no match has a sport linked.
 */
export async function getBigThreeStats(
  names: LiftNames = BIG_THREE_DEFAULT_NAMES,
): Promise<BigThreeStats> {
  const targetNames = [names.squat, names.bench, names.deadlift]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (targetNames.length === 0) {
    return { color: FALLBACK_COLOR, lifts: emptyStats() };
  }

  const rows = await db
    .select({
      exerciseName: metricTypes.name,
      sportId: metricTypes.sportId,
      setNumber: workoutSets.setNumber,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      rpe: workoutSets.rpe,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(metricTypes, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    // Case-insensitive match on the configured exercise names. SQLite's
    // built-in NOCASE collation matches lower-cased input regardless of
    // the stored row's case.
    .where(sql`LOWER(${metricTypes.name}) IN (${sql.join(
      targetNames.map((n) => sql`${n.toLowerCase()}`),
      sql`, `,
    )})`)
    .orderBy(desc(events.startedAt), desc(workoutSets.setNumber));

  const byLift: Record<Lift, typeof rows> = { squat: [], bench: [], deadlift: [] };
  for (const r of rows) {
    const lift = classifyLift(r.exerciseName, names);
    if (lift) byLift[lift].push(r);
  }

  // Color: pick up the sport_id of the first matched metric_type that
  // has one, look up its color. Lets a single-sport setup still get a
  // sport-tinted widget; a cross-sport setup gracefully falls back to
  // neutral.
  let color = FALLBACK_COLOR;
  const firstSportId = rows.find((r) => r.sportId !== null)?.sportId;
  if (firstSportId != null) {
    const sportRow = await db
      .select({ color: sports.color })
      .from(sports)
      .where(eq(sports.id, firstSportId))
      .limit(1);
    if (sportRow[0]) color = sportRow[0].color;
  }

  return {
    color,
    lifts: {
      squat: buildLiftStats("squat", byLift.squat),
      bench: buildLiftStats("bench", byLift.bench),
      deadlift: buildLiftStats("deadlift", byLift.deadlift),
    },
  };
}

function buildLiftStats(
  lift: Lift,
  rows: {
    exerciseName: string;
    setNumber: number;
    reps: number;
    weight: number;
    rpe: number | null;
    startedAt: string;
  }[]
): LiftStats {
  if (rows.length === 0) {
    return { lift, currentE1RM: null, topSet: null, pr1RM: null, history: [] };
  }

  // History: one point per day (session). Use YYYY-MM-DD as the session
  // key so multiple events on the same calendar day collapse (common with
  // FitNotes-style per-set events).
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const e = oconnorE1RM(r.weight, r.reps);
    if (e <= 0) continue;
    const day = r.startedAt.slice(0, 10);
    const existing = byDay.get(day) ?? 0;
    if (e > existing) byDay.set(day, e);
  }
  const history = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, e1rm]) => ({ date, e1rm: Math.round(e1rm) }));

  // Current e1RM + top set of the latest session with any countable reps.
  // Walk descending-sorted rows, grab the first session day that yields a
  // non-zero e1RM, then pick the best set within it.
  const sortedDesc = [...rows].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  let currentE1RM: number | null = null;
  let topSet: LiftTopSet | null = null;
  for (const r of sortedDesc) {
    const day = r.startedAt.slice(0, 10);
    if (topSet && topSet.date.slice(0, 10) !== day) break; // left the latest session
    const e = oconnorE1RM(r.weight, r.reps);
    if (e <= 0) continue;
    if (!topSet || e > topSet.e1rm) {
      topSet = {
        date: r.startedAt,
        weight: r.weight,
        reps: r.reps,
        rpe: r.rpe,
        e1rm: Math.round(e),
      };
      currentE1RM = Math.round(e);
    }
  }

  // Actual 1-rep PR: heaviest set with reps === 1.
  let pr1RM: LiftPR1RM | null = null;
  for (const r of rows) {
    if (r.reps !== 1) continue;
    if (!pr1RM || r.weight > pr1RM.weight) {
      pr1RM = { date: r.startedAt, weight: r.weight };
    }
  }

  return { lift, currentE1RM, topSet, pr1RM, history };
}

function emptyStats(): Record<Lift, LiftStats> {
  const empty = (lift: Lift): LiftStats => ({
    lift,
    currentE1RM: null,
    topSet: null,
    pr1RM: null,
    history: [],
  });
  return { squat: empty("squat"), bench: empty("bench"), deadlift: empty("deadlift") };
}
