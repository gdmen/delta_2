import { db } from "@/db";
import { workoutSets, events, sports, metricTypes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Big-3 stats for the powerlifting page. Derives everything from
 * workout_sets on read - no schema, no ingest-time aggregation. Formula is
 * O'Conner: e1RM = weight * (1 + 0.025 * reps). Reps > 10 skipped (formula
 * degrades). All-time PR is the heaviest actual 1-rep set, not e1RM.
 */

export type Lift = "squat" | "bench" | "deadlift";

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
 * Per-lift exercise name. The classifier matches by exact (case-insensitive)
 * name, no substring/excludes guessing. The user picks the canonical name
 * for each slot via the Big-3 widget settings; the coach path uses
 * `BIG_THREE_DEFAULT_NAMES` when it doesn't have a widget config to read.
 */
export interface LiftNames {
  squat: string;
  bench: string;
  deadlift: string;
}

export const BIG_THREE_DEFAULT_NAMES: LiftNames = {
  squat: "Barbell Back Squat",
  bench: "Flat Barbell Bench Press",
  deadlift: "Barbell Deadlift",
};

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
 * Returns stats for all three lifts plus the sport color. Reads workout_sets
 * joined to events filtered to the powerlifting sport. Safe when empty.
 *
 * `names` lets callers override the default canonical exercise names per
 * slot (squat/bench/deadlift). Defaults to BIG_THREE_DEFAULT_NAMES.
 */
export async function getBigThreeStats(
  names: LiftNames = BIG_THREE_DEFAULT_NAMES,
): Promise<BigThreeStats> {
  // Find the powerlifting sport. Return empty stats if it isn't present —
  // can happen on a fresh DB before any merge has produced a canonical
  // "powerlifting" row.
  const sportRow = await db
    .select({ id: sports.id, color: sports.color })
    .from(sports)
    .where(eq(sports.name, "powerlifting"))
    .limit(1);
  if (sportRow.length === 0) {
    return { color: FALLBACK_COLOR, lifts: emptyStats() };
  }
  const { id: powerliftingId, color } = sportRow[0];

  const rows = await db
    .select({
      exerciseName: metricTypes.name,
      setNumber: workoutSets.setNumber,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      rpe: workoutSets.rpe,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(metricTypes, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    .where(eq(events.sportId, powerliftingId))
    .orderBy(desc(events.startedAt), desc(workoutSets.setNumber));

  const byLift: Record<Lift, typeof rows> = { squat: [], bench: [], deadlift: [] };
  for (const r of rows) {
    const lift = classifyLift(r.exerciseName, names);
    if (lift) byLift[lift].push(r);
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
