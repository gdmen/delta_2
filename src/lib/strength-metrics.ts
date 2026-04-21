import { db } from "@/db";
import { workoutSets, events, sports } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

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

const LIFT_PATTERNS: Record<Lift, { exact: string[]; includes: string[]; excludes: string[] }> = {
  squat: {
    exact: [
      "Barbell Back Squat",
      "Back Squat",
      "High Bar Squat",
      "Low Bar Squat",
      "Barbell Squat",
      "Squat",
    ],
    includes: ["squat"],
    // Don't match front squat, squat thruster, goblet squat, split squat.
    excludes: ["front", "thruster", "goblet", "split", "jump", "bulgarian"],
  },
  bench: {
    exact: [
      "Flat Barbell Bench Press",
      "Bench Press",
      "Barbell Bench Press",
      "Bench",
    ],
    includes: ["bench press"],
    // Exclude close-grip / incline / decline only if the user wants the
    // canonical flat bench. Keep simple - the page assumes you're lumping
    // all bench variants as "bench" is uncommon. Customize later.
    excludes: ["incline", "decline", "close-grip", "close grip", "dumbbell"],
  },
  deadlift: {
    exact: [
      "Conventional Barbell Deadlift",
      "Conventional Deadlift",
      "Barbell Deadlift",
      "Deadlift",
    ],
    includes: ["deadlift"],
    // Stiff-leg / Romanian / sumo / trap-bar are different movements; user
    // can rename via import-source aliases if they want them lumped.
    excludes: ["romanian", "rdl", "stiff", "sumo", "trap bar", "trap-bar", "deficit", "snatch"],
  },
};

export function classifyLift(exerciseName: string): Lift | null {
  const raw = exerciseName.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  for (const [lift, patterns] of Object.entries(LIFT_PATTERNS) as [Lift, typeof LIFT_PATTERNS[Lift]][]) {
    if (patterns.exact.some((e) => e.toLowerCase() === lower)) return lift;
  }
  for (const [lift, patterns] of Object.entries(LIFT_PATTERNS) as [Lift, typeof LIFT_PATTERNS[Lift]][]) {
    if (patterns.excludes.some((x) => lower.includes(x))) continue;
    if (patterns.includes.some((i) => lower.includes(i))) return lift;
  }
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

/**
 * Returns stats for all three lifts. Reads workout_sets joined to events
 * filtered to the powerlifting sport. Safe when empty.
 */
export async function getBigThreeStats(): Promise<Record<Lift, LiftStats>> {
  // Find the powerlifting sport id.  Return empty stats if it isn't seeded.
  const sportRow = await db
    .select({ id: sports.id })
    .from(sports)
    .where(eq(sports.name, "powerlifting"))
    .limit(1);
  if (sportRow.length === 0) return emptyStats();
  const powerliftingId = sportRow[0].id;

  const rows = await db
    .select({
      exerciseName: workoutSets.exerciseName,
      setNumber: workoutSets.setNumber,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      rpe: workoutSets.rpe,
      startedAt: events.startedAt,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .where(eq(events.sportId, powerliftingId))
    .orderBy(desc(events.startedAt), desc(workoutSets.setNumber));

  const byLift: Record<Lift, typeof rows> = { squat: [], bench: [], deadlift: [] };
  for (const r of rows) {
    const lift = classifyLift(r.exerciseName);
    if (lift) byLift[lift].push(r);
  }

  return {
    squat: buildLiftStats("squat", byLift.squat),
    bench: buildLiftStats("bench", byLift.bench),
    deadlift: buildLiftStats("deadlift", byLift.deadlift),
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
