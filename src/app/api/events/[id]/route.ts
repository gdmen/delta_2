import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { eq } from "drizzle-orm";

interface UpdateEventBody {
  sportId?: number;
  type?: string;
  durationMinutes?: number | null;
  notes?: string | null;
  startedAt?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: UpdateEventBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof events.$inferInsert> = {};
  if (body.sportId !== undefined) {
    if (typeof body.sportId !== "number") {
      return NextResponse.json({ error: "sportId must be a number" }, { status: 400 });
    }
    updates.sportId = body.sportId;
  }
  if (body.type !== undefined) {
    if (typeof body.type !== "string" || !body.type) {
      return NextResponse.json({ error: "type must be a non-empty string" }, { status: 400 });
    }
    updates.type = body.type;
  }
  if (body.durationMinutes !== undefined) {
    if (body.durationMinutes !== null && (typeof body.durationMinutes !== "number" || !Number.isFinite(body.durationMinutes))) {
      return NextResponse.json({ error: "durationMinutes must be a finite number or null" }, { status: 400 });
    }
    updates.durationMinutes = body.durationMinutes;
  }
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.startedAt !== undefined) {
    if (typeof body.startedAt !== "string" || !body.startedAt) {
      return NextResponse.json({ error: "startedAt must be a non-empty string" }, { status: 400 });
    }
    updates.startedAt = body.startedAt;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db.update(events).set(updates).where(eq(events.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  // Cascades to workout_sets and event_metrics via FK ON DELETE CASCADE.
  await db.delete(events).where(eq(events.id, id));
  return NextResponse.json({ ok: true });
}
