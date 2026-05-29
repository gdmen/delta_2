import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  activities,
  events,
  goals,
  metricTypes,
  mergeLog,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { parseMergeByIdBody } from "@/lib/merge-validation";
import {
  buildActivityMergedEntry,
  buildActivityMergePayload,
} from "@/lib/merge-log/builder";
import type { ActivityMergedEntry } from "@/lib/merge-log/types";
import { requireUserOr401 } from "@/lib/auth/require";

/**
 * POST /api/activities/merge
 * Body: { canonicalId: number, mergeIds: number[] }
 *
 * Re-points every activity_id FK from merged → canonical and deletes the merged
 * activities. Simpler than the metric-types merge: no unit mismatch, no aliases
 * table (cross-source activity canonicalization lives at the source-mapping
 * layer, not the DB), no daily_summaries.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const userId = user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseMergeByIdBody(body);
  if (!parsed.ok) return parsed.response;
  const { canonicalId, mergeIds } = parsed.value;

  // Existence check scoped by user_id (per the eng-review HIGH finding).
  // Without this, an attacker could pass mergeIds=[victim_sport_id] and
  // pass the existence check.
  const allIds = [canonicalId, ...mergeIds];
  const rows = await db
    .select({ id: activities.id, name: activities.name })
    .from(activities)
    .where(and(eq(activities.userId, userId), inArray(activities.id, allIds)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const canonical = byId.get(canonicalId);
  if (!canonical) {
    return NextResponse.json({ error: "canonicalId not found" }, { status: 404 });
  }
  if (mergeIds.some((id) => !byId.has(id))) {
    return NextResponse.json(
      { error: "One or more mergeIds not found" },
      { status: 404 },
    );
  }

  type Report = { mergeId: number; name: string; eventsMoved: number };

  const mergedEntries: ActivityMergedEntry[] = [];
  let mergeLogId: number | null = null;

  const report: Report[] = await db.transaction(async (tx) => {
    const out: Report[] = [];
    for (const mergeId of mergeIds) {
      const merged = byId.get(mergeId)!;

      // Snapshot BEFORE the activity delete — dashboards.activity_id has
      // ON DELETE SET NULL, so a post-delete read would always return
      // empty. Capture mid-loop for multi-row merge correctness.
      mergedEntries.push(await buildActivityMergedEntry(tx, mergeId));

      // Defense-in-depth: scope every retarget by user_id.
      const eventsUpd = await tx
        .update(events)
        .set({ activityId: canonicalId })
        .where(and(eq(events.userId, userId), eq(events.activityId, mergeId)))
        .returning({ id: events.id });

      // focuses no longer carry activity_id directly — they reach activity via their
      // goal, so updating goals below carries focuses along.
      await tx
        .update(goals)
        .set({ activityId: canonicalId })
        .where(and(eq(goals.userId, userId), eq(goals.activityId, mergeId)));
      await tx
        .update(metricTypes)
        .set({ activityId: canonicalId })
        .where(
          and(eq(metricTypes.userId, userId), eq(metricTypes.activityId, mergeId)),
        );

      await tx
        .delete(activities)
        .where(and(eq(activities.userId, userId), eq(activities.id, mergeId)));

      out.push({ mergeId, name: merged.name, eventsMoved: eventsUpd.length });
    }

    const payload = buildActivityMergePayload(canonicalId, mergedEntries);
    const mergedNames = mergedEntries.map((m) => m.row.name).join(", ");
    const inserted = await tx
      .insert(mergeLog)
      .values({
        userId,
        kind: "activity",
        canonicalId,
        canonicalName: canonical.name,
        mergedNames,
        payload: JSON.stringify(payload),
      })
      .returning({ id: mergeLog.id });
    mergeLogId = inserted[0]?.id ?? null;

    return out;
  });

  return NextResponse.json({
    canonical: { id: canonical.id, name: canonical.name },
    merged: report,
    mergeLogId,
  });
}
