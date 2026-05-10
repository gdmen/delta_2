import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metrics } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface UpdateMetricBody {
  value?: number;
  recordedAt?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: UpdateMetricBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof metrics.$inferInsert> = {};
  if (body.value !== undefined) {
    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return NextResponse.json({ error: "value must be a finite number" }, { status: 400 });
    }
    updates.value = body.value;
  }
  if (body.recordedAt !== undefined) {
    if (typeof body.recordedAt !== "string" || !body.recordedAt) {
      return NextResponse.json({ error: "recordedAt must be a non-empty string" }, { status: 400 });
    }
    updates.recordedAt = body.recordedAt;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db
    .update(metrics)
    .set(updates)
    .where(and(userScope(user.id).metrics, eq(metrics.id, id)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await db
    .delete(metrics)
    .where(and(userScope(user.id).metrics, eq(metrics.id, id)));
  return NextResponse.json({ ok: true });
}
