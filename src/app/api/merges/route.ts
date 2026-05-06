import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mergeLog } from "@/db/schema";
import { desc } from "drizzle-orm";

/**
 * GET /api/merges?limit=N
 *
 * Returns recent merge_log entries (newest first). Each row carries
 * enough metadata for the /data/merges page chrome and the undo button.
 *
 * IMPORTANT: the `payload` column is intentionally excluded — it's up
 * to ~400KB of JSON per row and decoding 20 rows would create a 200ms
 * hitch on every page load. The undo endpoint reads the payload
 * directly when called.
 */

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const limitRaw = request.nextUrl.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const parsed = parseInt(limitRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const rows = await db
    .select({
      id: mergeLog.id,
      kind: mergeLog.kind,
      createdAt: mergeLog.createdAt,
      canonicalId: mergeLog.canonicalId,
      canonicalName: mergeLog.canonicalName,
      mergedNames: mergeLog.mergedNames,
      undoneAt: mergeLog.undoneAt,
      userId: mergeLog.userId,
    })
    .from(mergeLog)
    .orderBy(desc(mergeLog.createdAt))
    .limit(limit);

  return NextResponse.json({ merges: rows });
}
