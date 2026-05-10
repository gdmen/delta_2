import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { focuses, goalJournalEntries, goals } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { generateCloseFocusVerdict } from "@/lib/coach/close-focus-verdict";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * POST /api/goals/:id/focuses/:fid/close
 *
 * Closes a focus and (best-effort) appends an LLM-generated verdict to the
 * goal's journal as a new entry tagged with verdict_focus_id = fid.
 *
 * Body (optional): { status?: "completed" | "abandoned" }  default "completed"
 *
 * Ordering matters: the focus is closed FIRST (status + end_date), so even
 * if the LLM call fails the focus is in a clean state. The verdict is then
 * generated and appended; if that fails, the focus stays closed and the
 * UI shows a "retry verdict" affordance via the existing edit path.
 *
 * Returns:
 *   { ok: true, focusId, status, endDate, verdict?: { entryId, markdown } }
 *
 * If the verdict step fails the response still has ok=true (the close
 * succeeded) but `verdict` is omitted and `verdict_error` is populated.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fid: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr, fid: fidStr } = await params;
  const goalId = Number(idStr);
  const focusId = Number(fidStr);
  if (!Number.isFinite(goalId) || goalId <= 0) {
    return NextResponse.json({ error: "invalid goal id" }, { status: 400 });
  }
  if (!Number.isFinite(focusId) || focusId <= 0) {
    return NextResponse.json({ error: "invalid focus id" }, { status: 400 });
  }

  // Confirm the focus exists on this goal AND that the goal belongs to this
  // user. focuses is INHERIT — scope through goals.user_id.
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(user.id).goals);
  const existing = await db
    .select({ id: focuses.id, status: focuses.status })
    .from(focuses)
    .where(
      and(
        eq(focuses.id, focusId),
        eq(focuses.goalId, goalId),
        inArray(focuses.goalId, ownedGoalIds),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "focus not found on this goal" }, { status: 404 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // body is optional — no JSON is fine, default to "completed".
  }
  const b = (body ?? {}) as { status?: unknown };
  const status =
    b.status === "abandoned" ? "abandoned" : "completed";

  const closeDate = new Date().toISOString().slice(0, 10);

  // STEP 1: close the focus. Always succeeds (modulo DB unavailability).
  // This is the "verdict failure must not leave focus in limbo" guarantee.
  await db
    .update(focuses)
    .set({ status, endDate: closeDate })
    .where(and(eq(focuses.id, focusId), inArray(focuses.goalId, ownedGoalIds)));

  // STEP 2: best-effort verdict generation. Pass the just-closed focus to
  // the verdict generator (it'll re-read the focus row to pick up the new
  // end_date / status).
  const verdictResult = await generateCloseFocusVerdict({
    goalId,
    focusId,
    userId: user.id,
  });

  if (!verdictResult.ok) {
    // Focus stays closed; surface the LLM error so the UI can show a retry
    // hint. We deliberately do NOT 5xx here — the close itself succeeded
    // and the user shouldn't see a generic failure for a verdict miss.
    return NextResponse.json({
      ok: true,
      focusId,
      status,
      endDate: closeDate,
      verdict_error: verdictResult.error,
    });
  }

  // STEP 3: append the verdict to the goal's journal as a tagged entry.
  const inserted = await db
    .insert(goalJournalEntries)
    .values({
      goalId,
      content: verdictResult.verdictMarkdown,
      verdictFocusId: focusId,
    })
    .returning({
      id: goalJournalEntries.id,
      createdAt: goalJournalEntries.createdAt,
    });

  return NextResponse.json({
    ok: true,
    focusId,
    status,
    endDate: closeDate,
    verdict: {
      entryId: inserted[0].id,
      markdown: verdictResult.verdictMarkdown,
      referencesPriorFocuses: verdictResult.referencesPriorFocuses,
      meta: {
        tokensIn: verdictResult.tokensIn,
        tokensOut: verdictResult.tokensOut,
        durationMs: verdictResult.durationMs,
      },
    },
  });
}
