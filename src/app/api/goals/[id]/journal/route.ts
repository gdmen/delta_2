import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { goalJournalEntries, goals } from "@/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

// Hard cap so a runaway paste doesn't accidentally land a 10MB row.
const MAX_CONTENT_BYTES = 50_000;

/**
 * GET /api/goals/:id/journal
 * Returns the goal's journal entries, newest first. Lightweight — no joins,
 * the goal page already knows the goal it's on.
 *
 * goal_journal_entries is INHERIT — scoped through this user's goals.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const goalId = Number(idStr);
  if (!Number.isFinite(goalId) || goalId <= 0) {
    return NextResponse.json({ error: "invalid goal id" }, { status: 400 });
  }

  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(user.id).goals);
  const rows = await db
    .select({
      id: goalJournalEntries.id,
      content: goalJournalEntries.content,
      createdAt: goalJournalEntries.createdAt,
      verdictFocusId: goalJournalEntries.verdictFocusId,
      linkedMetricTypeId: goalJournalEntries.linkedMetricTypeId,
    })
    .from(goalJournalEntries)
    .where(
      and(
        eq(goalJournalEntries.goalId, goalId),
        inArray(goalJournalEntries.goalId, ownedGoalIds),
      ),
    )
    .orderBy(desc(goalJournalEntries.createdAt));

  return NextResponse.json(rows);
}

/**
 * POST /api/goals/:id/journal
 * Body: { content: string, verdictFocusId?: number, linkedMetricTypeId?: number }
 * Returns 201 with the new entry. Content is required, trimmed of trailing
 * whitespace, ≤50KB. verdictFocusId/linkedMetricTypeId are optional pointers.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const goalId = Number(idStr);
  if (!Number.isFinite(goalId) || goalId <= 0) {
    return NextResponse.json({ error: "invalid goal id" }, { status: 400 });
  }

  // Confirm the goal exists AND belongs to this user — surface a clean 404
  // instead of a FK violation or cross-user write.
  const g = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(userScope(user.id).goals, eq(goals.id, goalId)))
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
    content?: unknown;
    verdictFocusId?: unknown;
    linkedMetricTypeId?: unknown;
  };

  const content = typeof b.content === "string" ? b.content.trimEnd() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: `content too large (max ${MAX_CONTENT_BYTES} bytes)` },
      { status: 400 },
    );
  }

  let verdictFocusId: number | null = null;
  if (b.verdictFocusId !== null && b.verdictFocusId !== undefined) {
    const n = Number(b.verdictFocusId);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "verdictFocusId must be a positive integer" },
        { status: 400 },
      );
    }
    verdictFocusId = n;
  }

  let linkedMetricTypeId: number | null = null;
  if (b.linkedMetricTypeId !== null && b.linkedMetricTypeId !== undefined) {
    const n = Number(b.linkedMetricTypeId);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "linkedMetricTypeId must be a positive integer" },
        { status: 400 },
      );
    }
    linkedMetricTypeId = n;
  }

  const inserted = await db
    .insert(goalJournalEntries)
    .values({ goalId, content, verdictFocusId, linkedMetricTypeId })
    .returning({
      id: goalJournalEntries.id,
      content: goalJournalEntries.content,
      createdAt: goalJournalEntries.createdAt,
      verdictFocusId: goalJournalEntries.verdictFocusId,
      linkedMetricTypeId: goalJournalEntries.linkedMetricTypeId,
    });

  return NextResponse.json(inserted[0], { status: 201 });
}
