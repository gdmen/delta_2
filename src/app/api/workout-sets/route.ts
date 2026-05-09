import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSets } from "@/db/schema";
import { buildMetricTypeCache, resolveMetricTypeId } from "@/lib/ingest/metric-resolver";

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

  // Resolve the free-text exercise name to a metric_types row. Known names
  // (canonical or previously-aliased) route to their existing id; unknown
  // ones auto-create under `manual:<rawName>` for user review later.
  const cache = await buildMetricTypeCache(1) /* TODO(pr2-phase-3): pass user.id */;
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
