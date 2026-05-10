import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, workoutSets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { buildMetricTypeCache, resolveMetricTypeId } from "@/lib/ingest/metric-resolver";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface CreateSetBody {
  eventId: number;
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number;
  rpe?: number | null;
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: Partial<CreateSetBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body.eventId !== "number" ||
    typeof body.exerciseName !== "string" || !body.exerciseName ||
    typeof body.setNumber !== "number" ||
    typeof body.reps !== "number" ||
    typeof body.weight !== "number"
  ) {
    return NextResponse.json(
      { error: "eventId, exerciseName, setNumber, reps, weight are required" },
      { status: 400 }
    );
  }

  // INHERIT scoping: workout_sets has no user_id; confirm parent event
  // belongs to this user before inserting.
  const owns = await db
    .select({ id: events.id })
    .from(events)
    .where(and(userScope(user.id).events, eq(events.id, body.eventId)))
    .limit(1);
  if (owns.length === 0) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  // Resolve the free-text exercise name to a metric_types row. Known names
  // (canonical or previously-aliased) route to their existing id; unknown
  // ones auto-create under `manual:<rawName>` for user review later.
  const cache = await buildMetricTypeCache(user.id);
  const { id: exerciseMetricTypeId } = await resolveMetricTypeId({
    rawName: body.exerciseName,
    map: { [body.exerciseName]: body.exerciseName },
    sourceSystem: "manual",
    cache,
  });

  const result = await db
    .insert(workoutSets)
    .values({
      eventId: body.eventId,
      exerciseMetricTypeId,
      setNumber: body.setNumber,
      reps: body.reps,
      weight: body.weight,
      rpe: body.rpe ?? null,
      notes: body.notes ?? null,
    })
    .returning({ id: workoutSets.id });

  return NextResponse.json({ id: result[0].id });
}
