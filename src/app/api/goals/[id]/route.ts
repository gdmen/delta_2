import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { eq } from "drizzle-orm";

interface UpdateGoalBody {
  targetValue?: number;
  deadline?: string; // YYYY-MM-DD
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: UpdateGoalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof goals.$inferInsert> = {};
  if (body.targetValue !== undefined) {
    if (typeof body.targetValue !== "number" || !Number.isFinite(body.targetValue)) {
      return NextResponse.json({ error: "targetValue must be a finite number" }, { status: 400 });
    }
    updates.targetValue = body.targetValue;
  }
  if (body.deadline !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deadline)) {
      return NextResponse.json({ error: "deadline must be YYYY-MM-DD" }, { status: 400 });
    }
    updates.deadline = body.deadline;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db.update(goals).set(updates).where(eq(goals.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await db.delete(goals).where(eq(goals.id, id));
  return NextResponse.json({ ok: true });
}
