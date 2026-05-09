import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { focuses, goals } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { suggestFocuses } from "@/lib/coach/suggest-focuses";
import { getLastSuccessfulCallAt } from "@/lib/coach/track-call";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * POST /api/goals/:id/suggest-focuses
 *
 * Generates LLM-suggested focuses for a goal and persists them as
 * `focuses` rows with `source='llm'` and `evidence` as a JSON blob of
 * the supporting signals. Existing un-dismissed LLM proposals on this
 * goal are dropped first so the tray only shows the latest set.
 *
 * Query params:
 *   ?if_stale=true  → only re-run if the last successful call is older
 *                     than 7 days. Used by the stale-on-load client
 *                     trigger to avoid hammering the API on every page
 *                     view. Returns { skipped: true } when fresh.
 *
 * Errors are typed (`rate_limit`, `llm_unavailable`, `malformed_llm_output`,
 * `missing_api_key`, `internal`) so the UI can map each to a toast +
 * retry behavior. Status codes follow the convention: 502 for upstream
 * LLM problems, 500 for our own bugs, 401-equivalent for missing key.
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

  const g = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(userScope(user.id).goals, eq(goals.id, goalId)))
    .limit(1);
  if (g.length === 0) {
    return NextResponse.json({ error: "goal not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const ifStale = url.searchParams.get("if_stale") === "true";
  if (ifStale) {
    const lastAt = await getLastSuccessfulCallAt(goalId, "suggest-focuses", user.id);
    if (lastAt && Date.now() - lastAt.getTime() < STALE_THRESHOLD_MS) {
      return NextResponse.json({ skipped: true, reason: "fresh", lastAt: lastAt.toISOString() });
    }
  }

  const result = await suggestFocuses(goalId, user.id);

  if (!result.ok) {
    const status =
      result.error.error === "rate_limit"
        ? 429
        : result.error.error === "llm_unavailable"
          ? 502
          : result.error.error === "malformed_llm_output"
            ? 502
            : result.error.error === "missing_api_key"
              ? 500
              : 500;
    return NextResponse.json(result.error, { status });
  }

  // Replace any previous un-dismissed LLM suggestions for this goal so the
  // tray shows only the freshest set. Dismissed ones stay (the prompt uses
  // them to avoid re-proposing). focuses is INHERIT — scope through this
  // user's goals.
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(user.id).goals);
  await db
    .delete(focuses)
    .where(
      and(
        eq(focuses.goalId, goalId),
        eq(focuses.source, "llm"),
        isNull(focuses.dismissedAt),
        inArray(focuses.goalId, ownedGoalIds),
      ),
    );

  const today = new Date().toISOString().slice(0, 10);
  const inserted: Array<{ id: number; name: string; rationale: string; evidence: unknown }> = [];

  for (const s of result.suggestions) {
    const evidenceJson = JSON.stringify({
      rationale: s.rationale,
      ...s.evidence,
    });
    const rows = await db
      .insert(focuses)
      .values({
        name: s.name,
        goalId,
        source: "llm",
        startDate: today,
        status: "active",
        evidence: evidenceJson,
      })
      .returning({
        id: focuses.id,
        name: focuses.name,
      });
    inserted.push({
      id: rows[0].id,
      name: rows[0].name,
      rationale: s.rationale,
      evidence: s.evidence,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      suggestions: inserted,
      meta: {
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        durationMs: result.durationMs,
      },
    },
    { status: 200 },
  );
}
