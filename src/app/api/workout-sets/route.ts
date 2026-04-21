import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSets } from "@/db/schema";

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

  const result = await db
    .insert(workoutSets)
    .values({
      eventId: body.eventId,
      exerciseName: body.exerciseName,
      setNumber: body.setNumber,
      reps: body.reps,
      weight: body.weight,
      rpe: body.rpe ?? null,
      notes: body.notes ?? null,
    })
    .returning({ id: workoutSets.id });

  return NextResponse.json({ id: result[0].id });
}
