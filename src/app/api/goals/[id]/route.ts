import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { goals, focuses, metricTypes } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { STATUSES, type Status, isStatus } from "@/lib/enums";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface UpdateGoalBody {
  targetValue?: number;
  deadline?: string; // YYYY-MM-DD
  status?: Status;
  metricTypeId?: number;
  // Only meaningful when status is set to "abandoned". If true, every active
  // focus pointing at this goal is also moved to "abandoned" in the same
  // request so callers don't have to orchestrate two PATCHes.
  abandonLinkedFocuses?: boolean;
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
  if (body.status !== undefined) {
    if (!isStatus(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    updates.status = body.status;
  }
  if (body.metricTypeId !== undefined) {
    if (!Number.isInteger(body.metricTypeId) || body.metricTypeId <= 0) {
      return NextResponse.json(
        { error: "metricTypeId must be a positive integer" },
        { status: 400 },
      );
    }
    // Verify the metric_type exists. The goals table has a FK on
    // metricTypeId so a bad id would 500 from SQLite; better to 400 here
    // with a useful message. Scope by user_id so a probe with another
    // user's metric_type returns the same not-found.
    const exists = await db
      .select({ id: metricTypes.id })
      .from(metricTypes)
      .where(and(userScope(user.id).metricTypes, eq(metricTypes.id, body.metricTypeId)))
      .limit(1);
    if (exists.length === 0) {
      return NextResponse.json(
        { error: `metric_type ${body.metricTypeId} not found` },
        { status: 400 },
      );
    }
    updates.metricTypeId = body.metricTypeId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db
    .update(goals)
    .set(updates)
    .where(and(userScope(user.id).goals, eq(goals.id, id)));

  // Cascading focus abandon happens after the goal update so a failed
  // update above doesn't leave us with half-applied state. focuses is an
  // INHERIT table — scope through this user's goals so we never write to
  // another user's row.
  let abandonedFocuses = 0;
  if (body.abandonLinkedFocuses && body.status === "abandoned") {
    const ownedGoalIds = db
      .select({ id: goals.id })
      .from(goals)
      .where(userScope(user.id).goals);
    const result = await db
      .update(focuses)
      .set({ status: "abandoned" })
      .where(
        and(
          eq(focuses.goalId, id),
          eq(focuses.status, "active"),
          inArray(focuses.goalId, ownedGoalIds),
        ),
      )
      .returning({ id: focuses.id });
    abandonedFocuses = result.length;
  }

  return NextResponse.json({ ok: true, abandonedFocuses });
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
    .delete(goals)
    .where(and(userScope(user.id).goals, eq(goals.id, id)));
  return NextResponse.json({ ok: true });
}
