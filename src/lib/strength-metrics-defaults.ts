/**
 * Pure constants for the big-3 widget. Lives in its own file so the
 * widget schema (loaded into the editor's client bundle via the
 * widget registry) can import them without dragging
 * `src/lib/strength-metrics.ts`'s `import { db } from "@/db"` into
 * the browser — postgres-js isn't browser-safe.
 */

export type Lift = "squat" | "bench" | "deadlift";

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
