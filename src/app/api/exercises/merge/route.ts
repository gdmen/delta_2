import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSets } from "@/db/schema";
import { inArray } from "drizzle-orm";

/**
 * POST /api/exercises/merge
 * Body: { canonical: string, mergeNames: string[] }
 *
 * Rewrites workout_sets.exercise_name from each merged name to the canonical.
 * Exercises aren't their own table — they exist only as text on
 * workout_sets — so the merge is a single UPDATE. No unique constraints on
 * (event_id, exercise_name, set_number), so collisions are allowed by the
 * DB; if a workout happened to log both "bench" and "flat bench" with the
 * same set_number, the merged result will have duplicate set rows. Rare
 * and visible.
 */
export async function POST(request: NextRequest) {
  let body: { canonical?: string; mergeNames?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const canonical = body.canonical?.trim();
  const mergeNames = Array.isArray(body.mergeNames)
    ? [...new Set(body.mergeNames.map((s) => String(s).trim()).filter(Boolean))]
    : [];
  if (!canonical) {
    return NextResponse.json({ error: "canonical is required" }, { status: 400 });
  }
  if (mergeNames.length === 0) {
    return NextResponse.json({ error: "mergeNames must be non-empty" }, { status: 400 });
  }
  if (mergeNames.includes(canonical)) {
    return NextResponse.json(
      { error: "canonical cannot be in mergeNames" },
      { status: 400 },
    );
  }

  const updated = await db
    .update(workoutSets)
    .set({ exerciseName: canonical })
    .where(inArray(workoutSets.exerciseName, mergeNames))
    .returning({ id: workoutSets.id });

  return NextResponse.json({ canonical, setsMoved: updated.length });
}
