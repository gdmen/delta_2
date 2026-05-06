import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mergeLog, metricTypes, sports } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import type { MergeLogPayloadV1 } from "@/lib/merge-log/types";
import { applyMergeUndo } from "@/lib/merge-log/applier";

/**
 * POST /api/merges/:id/undo
 *
 * Undo a previously-recorded merge. Steps:
 *
 *   1. CAS-flip merge_log.undone_at from NULL to now() inside a single
 *      UPDATE...RETURNING. If no row returned, the merge is already
 *      undone or someone else just claimed it — 409. This is the
 *      TOCTOU-safe replacement for read-then-check.
 *   2. Pre-check that every metric_type / sport id the payload
 *      references still exists. Catches:
 *        - Chain merges (canonical was itself merged into something
 *          else, so its id may be gone or repointed).
 *        - Manual deletion of the canonical via /api/metric-types/[id].
 *      If anything's missing, restore the undone_at flag (release the
 *      claim) and 409 with a diagnostic.
 *   3. Run the applier inside one db.transaction(). Sync — the
 *      daily_summaries recompute happens before the response returns
 *      so the dashboard is immediately correct on undo (per the plan's
 *      Q2 answer).
 *
 * Returns the canonical id/name + the count of merged ids restored.
 */

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }

  // Step 1: CAS-flip undone_at. If no row returned → already undone or
  // not found.
  const claimed = await db
    .update(mergeLog)
    .set({ undoneAt: sql`(datetime('now'))` })
    .where(sql`${mergeLog.id} = ${id} AND ${mergeLog.undoneAt} IS NULL`)
    .returning({
      id: mergeLog.id,
      kind: mergeLog.kind,
      payload: mergeLog.payload,
      canonicalId: mergeLog.canonicalId,
      canonicalName: mergeLog.canonicalName,
    });

  if (claimed.length === 0) {
    // Either id doesn't exist OR already undone. Distinguish so the
    // user gets a useful error.
    const existing = await db
      .select({ id: mergeLog.id, undoneAt: mergeLog.undoneAt })
      .from(mergeLog)
      .where(eq(mergeLog.id, id))
      .limit(1);
    if (existing.length === 0) {
      return NextResponse.json({ error: "merge not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "merge already undone (or another undo is in flight)" },
      { status: 409 },
    );
  }

  const row = claimed[0];

  // Parse payload.
  let payload: MergeLogPayloadV1;
  try {
    payload = JSON.parse(row.payload) as MergeLogPayloadV1;
  } catch (err) {
    // Roll back the claim — the row is corrupted, can't undo.
    await db.update(mergeLog).set({ undoneAt: null }).where(eq(mergeLog.id, id)).run();
    return NextResponse.json(
      { error: `merge payload corrupted: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  if (payload.v !== 1) {
    await db.update(mergeLog).set({ undoneAt: null }).where(eq(mergeLog.id, id)).run();
    return NextResponse.json(
      { error: `unsupported merge_log payload version: ${payload.v}` },
      { status: 500 },
    );
  }

  // Step 2: pre-check that all referenced ids still exist (chain
  // detection + manual-delete detection). The merged ids must NOT
  // exist yet (we're about to re-insert them); the canonical id MUST
  // exist (the rows we'll re-point reference it).
  if (payload.kind === "metric_type") {
    const canonicalRow = await db
      .select({ id: metricTypes.id })
      .from(metricTypes)
      .where(eq(metricTypes.id, payload.canonicalId))
      .limit(1);
    if (canonicalRow.length === 0) {
      await db.update(mergeLog).set({ undoneAt: null }).where(eq(mergeLog.id, id)).run();
      return NextResponse.json(
        {
          error:
            "Canonical metric_type no longer exists. It may have been merged again, or deleted manually. Restore manually before undoing this merge, or undo any more-recent merge that touched it first.",
        },
        { status: 409 },
      );
    }
    const mergedIds = payload.merged.map((m) => m.row.id);
    if (mergedIds.length > 0) {
      const colliding = await db
        .select({ id: metricTypes.id })
        .from(metricTypes)
        .where(inArray(metricTypes.id, mergedIds));
      if (colliding.length > 0) {
        await db.update(mergeLog).set({ undoneAt: null }).where(eq(mergeLog.id, id)).run();
        return NextResponse.json(
          {
            error:
              "A metric_type with the same id as one of the merged rows already exists. Database state has diverged from the merge log; manual fix required.",
          },
          { status: 409 },
        );
      }
    }
  } else {
    const canonicalRow = await db
      .select({ id: sports.id })
      .from(sports)
      .where(eq(sports.id, payload.canonicalId))
      .limit(1);
    if (canonicalRow.length === 0) {
      await db.update(mergeLog).set({ undoneAt: null }).where(eq(mergeLog.id, id)).run();
      return NextResponse.json(
        {
          error:
            "Canonical sport no longer exists. It may have been merged again or deleted. Restore manually before undoing this merge.",
        },
        { status: 409 },
      );
    }
    const mergedIds = payload.merged.map((m) => m.row.id);
    if (mergedIds.length > 0) {
      const colliding = await db
        .select({ id: sports.id })
        .from(sports)
        .where(inArray(sports.id, mergedIds));
      if (colliding.length > 0) {
        await db.update(mergeLog).set({ undoneAt: null }).where(eq(mergeLog.id, id)).run();
        return NextResponse.json(
          {
            error:
              "A sport with the same id as one of the merged rows already exists. Database state has diverged from the merge log; manual fix required.",
          },
          { status: 409 },
        );
      }
    }
  }

  // Step 3: apply undo inside a transaction. Sync recompute of
  // daily_summaries happens here; dashboard is immediately correct.
  try {
    db.transaction((tx) => {
      applyMergeUndo(tx, payload);
    });
  } catch (err) {
    // Try to roll back the claim. Best-effort — if this fails too,
    // the row stays marked undone but the actual data didn't change.
    // The user can re-run undo and it'll 409 cleanly; manual SQL fix
    // is the recovery path for that rare failure.
    try {
      await db.update(mergeLog).set({ undoneAt: null }).where(eq(mergeLog.id, id)).run();
    } catch {
      // swallow — already in error path
    }
    return NextResponse.json(
      { error: `undo failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: row.id,
    kind: row.kind,
    canonical: { id: row.canonicalId, name: row.canonicalName },
    restoredCount: payload.merged.length,
  });
}
