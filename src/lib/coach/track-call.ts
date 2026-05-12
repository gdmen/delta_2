import { db } from "@/db";
import { coachCalls } from "@/db/schema";
import { desc, eq, and, gte } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";

export type CoachEndpoint = "suggest-focuses" | "summarize-period" | "close-focus-verdict";

/**
 * Append-only log of every LLM coach invocation. Metadata only — the
 * generated content lives in `focuses.evidence` (suggest-focuses) or
 * `goal_journal_entries.content` (verdicts/summaries). Lets us measure cost,
 * latency, and failure rates without joining to external service logs.
 *
 * Failures are logged too (status='failed' + error message in model field
 * is fine for v1) so we can see if a particular goal/endpoint keeps
 * blowing up.
 */
export async function trackCoachCall(args: {
  userId: number;
  endpoint: CoachEndpoint;
  goalId: number | null;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  model: string;
  status: "success" | "failed";
}): Promise<void> {
  await db.insert(coachCalls).values({
    userId: args.userId,
    endpoint: args.endpoint,
    goalId: args.goalId,
    tokensIn: args.tokensIn,
    tokensOut: args.tokensOut,
    durationMs: args.durationMs,
    model: args.model,
    status: args.status,
  });
}

/**
 * Returns the timestamp of the most recent SUCCESSFUL call for a given
 * (goal, endpoint) pair, or null if none exists. Used by the stale-on-load
 * trigger to decide whether suggestions are due for a refresh.
 */
export async function getLastSuccessfulCallAt(
  goalId: number,
  endpoint: CoachEndpoint,
  userId: number,
): Promise<Date | null> {
  const rows = await db
    .select({ ts: coachCalls.ts })
    .from(coachCalls)
    .where(
      and(
        userScope(userId).coachCalls,
        eq(coachCalls.goalId, goalId),
        eq(coachCalls.endpoint, endpoint),
        eq(coachCalls.status, "success"),
      ),
    )
    .orderBy(desc(coachCalls.ts))
    .limit(1);
  if (rows.length === 0) return null;
  return new Date(rows[0].ts);
}


/**
 * Lightweight health check: how many calls in the last 24h, broken down by
 * endpoint + status. Useful for "am I burning money" sanity in PR #4.
 */
export async function getRecentCoachCallStats(userId: number, hours = 24): Promise<{
  total: number;
  byEndpoint: Record<string, { success: number; failed: number; tokens: number }>;
}> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db
    .select({
      endpoint: coachCalls.endpoint,
      status: coachCalls.status,
      tokensIn: coachCalls.tokensIn,
      tokensOut: coachCalls.tokensOut,
    })
    .from(coachCalls)
    .where(and(userScope(userId).coachCalls, gte(coachCalls.ts, since)));

  const byEndpoint: Record<string, { success: number; failed: number; tokens: number }> = {};
  for (const r of rows) {
    let bucket = byEndpoint[r.endpoint];
    if (!bucket) {
      bucket = { success: 0, failed: 0, tokens: 0 };
      byEndpoint[r.endpoint] = bucket;
    }
    if (r.status === "success") bucket.success++;
    else bucket.failed++;
    bucket.tokens += r.tokensIn + r.tokensOut;
  }

  return { total: rows.length, byEndpoint };
}
