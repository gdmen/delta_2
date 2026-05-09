import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildMetricTypeCache, resolveMetricTypeId } from "@/lib/ingest/metric-resolver";

interface UpdateSetBody {
  exerciseName?: string;
  setNumber?: number;
  reps?: number;
  weight?: number;
  rpe?: number | null;
  notes?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: UpdateSetBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof workoutSets.$inferInsert> = {};
  if (body.exerciseName !== undefined) {
    if (typeof body.exerciseName !== "string" || !body.exerciseName) {
      return NextResponse.json({ error: "exerciseName must be a non-empty string" }, { status: 400 });
    }
    // Resolve the free-text name to a metric_types id. Same path manual
    // creation uses — known names route through aliases, unknown names
    // auto-create under `manual:<rawName>`.
    const cache = await buildMetricTypeCache(1) /* TODO(pr2-phase-3): pass user.id */;
    const { id: exerciseMetricTypeId } = await resolveMetricTypeId({
      rawName: body.exerciseName,
      map: { [body.exerciseName]: body.exerciseName },
      sourceSystem: "manual",
      cache,
    });
    updates.exerciseMetricTypeId = exerciseMetricTypeId;
  }
  if (body.setNumber !== undefined) {
    if (typeof body.setNumber !== "number" || !Number.isFinite(body.setNumber)) {
      return NextResponse.json({ error: "setNumber must be a finite number" }, { status: 400 });
    }
    updates.setNumber = body.setNumber;
  }
  if (body.reps !== undefined) {
    if (typeof body.reps !== "number" || !Number.isFinite(body.reps)) {
      return NextResponse.json({ error: "reps must be a finite number" }, { status: 400 });
    }
    updates.reps = body.reps;
  }
  if (body.weight !== undefined) {
    if (typeof body.weight !== "number" || !Number.isFinite(body.weight)) {
      return NextResponse.json({ error: "weight must be a finite number" }, { status: 400 });
    }
    updates.weight = body.weight;
  }
  if (body.rpe !== undefined) {
    if (body.rpe !== null && (typeof body.rpe !== "number" || !Number.isFinite(body.rpe))) {
      return NextResponse.json({ error: "rpe must be a finite number or null" }, { status: 400 });
    }
    updates.rpe = body.rpe;
  }
  if (body.notes !== undefined) updates.notes = body.notes;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db.update(workoutSets).set(updates).where(eq(workoutSets.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await db.delete(workoutSets).where(eq(workoutSets.id, id));
  return NextResponse.json({ ok: true });
}
