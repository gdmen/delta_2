import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  sports,
  events,
  goals,
  metricTypes,
  mergeLog,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { parseMergeByIdBody } from "@/lib/merge-validation";
import {
  buildSportMergedEntry,
  buildSportMergePayload,
} from "@/lib/merge-log/builder";
import type { SportMergedEntry } from "@/lib/merge-log/types";

/**
 * POST /api/sports/merge
 * Body: { canonicalId: number, mergeIds: number[] }
 *
 * Re-points every sport_id FK from merged → canonical and deletes the merged
 * sports. Simpler than the metric-types merge: no unit mismatch, no aliases
 * table (cross-source sport canonicalization lives at the source-mapping
 * layer, not the DB), no daily_summaries.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseMergeByIdBody(body);
  if (!parsed.ok) return parsed.response;
  const { canonicalId, mergeIds } = parsed.value;

  // TODO(pr2-phase-3): replace with `const { user } = await requireUserOr401()`.
  const userId = 1;

  // Existence check scoped by user_id (per the eng-review HIGH finding).
  // Without this, an attacker could pass mergeIds=[victim_sport_id] and
  // pass the existence check.
  const allIds = [canonicalId, ...mergeIds];
  const rows = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(and(eq(sports.userId, userId), inArray(sports.id, allIds)));
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

  const mergedEntries: SportMergedEntry[] = [];
  let mergeLogId: number | null = null;

  const report: Report[] = await db.transaction(async (tx) => {
    const out: Report[] = [];
    for (const mergeId of mergeIds) {
      const merged = byId.get(mergeId)!;

      // Snapshot BEFORE the sport delete — dashboards.sport_id has
      // ON DELETE SET NULL, so a post-delete read would always return
      // empty. Capture mid-loop for multi-row merge correctness.
      mergedEntries.push(await buildSportMergedEntry(tx, mergeId));

      // Defense-in-depth: scope every retarget by user_id.
      const eventsUpd = await tx
        .update(events)
        .set({ sportId: canonicalId })
        .where(and(eq(events.userId, userId), eq(events.sportId, mergeId)))
        .returning({ id: events.id });

      // focuses no longer carry sport_id directly — they reach sport via their
      // goal, so updating goals below carries focuses along.
      await tx
        .update(goals)
        .set({ sportId: canonicalId })
        .where(and(eq(goals.userId, userId), eq(goals.sportId, mergeId)));
      await tx
        .update(metricTypes)
        .set({ sportId: canonicalId })
        .where(
          and(eq(metricTypes.userId, userId), eq(metricTypes.sportId, mergeId)),
        );

      await tx
        .delete(sports)
        .where(and(eq(sports.userId, userId), eq(sports.id, mergeId)));

      out.push({ mergeId, name: merged.name, eventsMoved: eventsUpd.length });
    }

    const payload = buildSportMergePayload(canonicalId, mergedEntries);
    const mergedNames = mergedEntries.map((m) => m.row.name).join(", ");
    const inserted = await tx
      .insert(mergeLog)
      .values({
        userId,
        kind: "sport",
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
