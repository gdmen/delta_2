import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { focuses } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PATCH /api/goals/:id/focuses/:fid — mutate a focus on this goal.
 * Body: { status?, name?, technicalNotes?, endDate?, dismissedAt? }
 * Used to close ('completed'/'abandoned'), reopen ('active'), or edit. The
 * goal_id in the URL is enforced — you can't move a focus across goals
 * through this endpoint.
 *
 * Closing a focus does NOT auto-generate a verdict here — that lives on
 * /api/goals/:id/focuses/:fid/close (PR #3) which closes + LLM-summarises.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fid: string }> },
) {
  const { id: idStr, fid: fidStr } = await params;
  const goalId = Number(idStr);
  const focusId = Number(fidStr);
  if (!Number.isFinite(goalId) || goalId <= 0) {
    return NextResponse.json({ error: "invalid goal id" }, { status: 400 });
  }
  if (!Number.isFinite(focusId) || focusId <= 0) {
    return NextResponse.json({ error: "invalid focus id" }, { status: 400 });
  }

  const existing = await db
    .select({ id: focuses.id, status: focuses.status })
    .from(focuses)
    .where(and(eq(focuses.id, focusId), eq(focuses.goalId, goalId)))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "focus not found on this goal" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as {
    status?: unknown;
    name?: unknown;
    technicalNotes?: unknown;
    endDate?: unknown;
    dismissedAt?: unknown;
    source?: unknown;
  };

  const updates: {
    status?: "active" | "completed" | "abandoned";
    name?: string;
    technicalNotes?: string | null;
    endDate?: string | null;
    dismissedAt?: string | null;
    source?: "manual" | "llm";
  } = {};

  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "completed" && b.status !== "abandoned") {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    updates.status = b.status;
    // Auto-set end_date when transitioning to a closed state, unless the
    // caller supplied one explicitly. Reopening clears it.
    if (b.status === "active") {
      updates.endDate = null;
    } else if (b.endDate === undefined) {
      updates.endDate = new Date().toISOString().slice(0, 10);
    }
  }

  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) {
      return NextResponse.json({ error: "name must be non-empty" }, { status: 400 });
    }
    if (b.name.length > 200) {
      return NextResponse.json({ error: "name too long" }, { status: 400 });
    }
    updates.name = b.name.trim();
  }

  if (b.technicalNotes !== undefined) {
    if (b.technicalNotes !== null && typeof b.technicalNotes !== "string") {
      return NextResponse.json({ error: "technicalNotes must be string or null" }, { status: 400 });
    }
    updates.technicalNotes =
      typeof b.technicalNotes === "string" ? b.technicalNotes.trim() || null : null;
  }

  if (b.endDate !== undefined) {
    if (b.endDate === null || b.endDate === "") {
      updates.endDate = null;
    } else if (typeof b.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.endDate)) {
      updates.endDate = b.endDate;
    } else {
      return NextResponse.json({ error: "endDate must be YYYY-MM-DD or null" }, { status: 400 });
    }
  }

  if (b.dismissedAt !== undefined) {
    if (b.dismissedAt === null || b.dismissedAt === "") {
      updates.dismissedAt = null;
    } else if (typeof b.dismissedAt === "string") {
      updates.dismissedAt = b.dismissedAt;
    } else {
      return NextResponse.json({ error: "dismissedAt must be string or null" }, { status: 400 });
    }
  }

  if (b.source !== undefined) {
    if (b.source !== "manual" && b.source !== "llm") {
      return NextResponse.json({ error: "source must be 'manual' or 'llm'" }, { status: 400 });
    }
    updates.source = b.source;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  await db.update(focuses).set(updates).where(eq(focuses.id, focusId));

  return NextResponse.json({ ok: true, id: focusId, ...updates });
}

/**
 * DELETE /api/goals/:id/focuses/:fid — hard delete. Used for cleanup; usually
 * you'd close a focus rather than delete it. ON DELETE SET NULL on
 * goal_journal_entries.verdict_focus_id keeps verdict entries intact in the
 * journal but loses the back-reference.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fid: string }> },
) {
  const { id: idStr, fid: fidStr } = await params;
  const goalId = Number(idStr);
  const focusId = Number(fidStr);
  if (!Number.isFinite(goalId) || goalId <= 0) {
    return NextResponse.json({ error: "invalid goal id" }, { status: 400 });
  }
  if (!Number.isFinite(focusId) || focusId <= 0) {
    return NextResponse.json({ error: "invalid focus id" }, { status: 400 });
  }

  const result = await db
    .delete(focuses)
    .where(and(eq(focuses.id, focusId), eq(focuses.goalId, goalId)))
    .returning({ id: focuses.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "focus not found on this goal" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: focusId });
}
