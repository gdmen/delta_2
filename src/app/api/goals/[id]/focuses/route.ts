import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { focuses, goals } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/goals/:id/focuses — create a manual focus on this goal.
 * Body: { name: string, technicalNotes?: string, startDate?: string }
 * startDate defaults to today (YYYY-MM-DD) if not supplied. source is always
 * "manual" — LLM-suggested focuses come from /api/goals/:id/suggest-focuses
 * (PR #3) and are written there directly.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const goalId = Number(idStr);
  if (!Number.isFinite(goalId) || goalId <= 0) {
    return NextResponse.json({ error: "invalid goal id" }, { status: 400 });
  }

  const g = await db
    .select({ id: goals.id })
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);
  if (g.length === 0) {
    return NextResponse.json({ error: "goal not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as {
    name?: unknown;
    technicalNotes?: unknown;
    startDate?: unknown;
  };

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.length > 200) {
    return NextResponse.json({ error: "name too long (max 200 chars)" }, { status: 400 });
  }

  const technicalNotes =
    typeof b.technicalNotes === "string" ? b.technicalNotes.trim() : "";
  if (technicalNotes.length > 10_000) {
    return NextResponse.json(
      { error: "technical_notes too long (max 10000 chars)" },
      { status: 400 },
    );
  }

  const startDate =
    typeof b.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate)
      ? b.startDate
      : new Date().toISOString().slice(0, 10);

  const inserted = await db
    .insert(focuses)
    .values({
      name,
      goalId,
      source: "manual",
      startDate,
      status: "active",
      technicalNotes: technicalNotes || null,
    })
    .returning({
      id: focuses.id,
      name: focuses.name,
      goalId: focuses.goalId,
      source: focuses.source,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
      technicalNotes: focuses.technicalNotes,
    });

  return NextResponse.json(inserted[0], { status: 201 });
}
