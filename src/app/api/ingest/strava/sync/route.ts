import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sports } from "@/db/schema";
import { iterateActivities, loadTokens, touchLastSync, StravaActivity } from "@/lib/strava/client";
import { mapStravaType } from "@/lib/strava/mapping";
import { upsertEvent } from "@/lib/ingest-service";

export const maxDuration = 120;

interface SyncBody {
  after?: string; // ISO date. Default: since last sync, or 0 (all history) if never synced.
  mode?: "incremental" | "backfill";
}

interface SyncResult {
  fetched: number;
  accepted: number;
  skipped: number;
  unmappedTypes: Record<string, number>;
  errors: string[];
}

/**
 * POST /api/ingest/strava/sync
 * Body: { after?: "YYYY-MM-DD", mode?: "incremental" | "backfill" }
 *
 * Fetches Strava activities and upserts into events. Dedup key is source_id
 * = "strava-{activity.id}" so re-runs are idempotent.
 */
export async function POST(request: NextRequest) {
  const tokens = await loadTokens();
  if (!tokens) {
    return NextResponse.json({ error: "Strava not connected." }, { status: 400 });
  }

  let body: SyncBody = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    // ignore, use defaults
  }

  // Figure out the `after` Unix timestamp.
  let afterUnix = 0;
  if (body.mode === "backfill") {
    afterUnix = 0;
  } else if (body.after) {
    const parsed = new Date(body.after).getTime();
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "Invalid 'after' date" }, { status: 400 });
    }
    afterUnix = Math.floor(parsed / 1000);
  } else {
    // Incremental default: since last synced activity start. If never synced, last 90 days.
    // (Full backfill should be explicit via mode=backfill to avoid huge first-run requests.)
    const fallback = Date.now() - 90 * 24 * 60 * 60 * 1000;
    afterUnix = Math.floor(fallback / 1000);
  }

  // Preload sport name → id.
  const allSports = await db.select().from(sports);
  const sportIdByName = new Map(allSports.map((s) => [s.name, s.id]));

  const result: SyncResult = {
    fetched: 0,
    accepted: 0,
    skipped: 0,
    unmappedTypes: {},
    errors: [],
  };

  try {
    for await (const activity of iterateActivities(afterUnix)) {
      result.fetched++;
      await ingestOne(activity, sportIdByName, result);
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return NextResponse.json(result, { status: 500 });
  }

  await touchLastSync();

  return NextResponse.json(result);
}

async function ingestOne(
  activity: StravaActivity,
  sportIdByName: Map<string, number>,
  result: SyncResult
): Promise<void> {
  const mapping = mapStravaType(activity.type, activity.sport_type);
  if (!mapping) {
    const key = activity.sport_type ?? activity.type;
    result.unmappedTypes[key] = (result.unmappedTypes[key] ?? 0) + 1;
    result.skipped++;
    return;
  }

  const sportId = sportIdByName.get(mapping.sport);
  if (!sportId) {
    result.errors.push(`No sport row for '${mapping.sport}' — run seed.`);
    return;
  }

  // Compose notes from activity metadata that doesn't fit the schema columns.
  const notesParts: string[] = [];
  if (activity.name) notesParts.push(activity.name);
  if (activity.distance) {
    const miles = (activity.distance / 1609.344).toFixed(2);
    notesParts.push(`${miles} mi`);
  }
  if (activity.total_elevation_gain) {
    notesParts.push(`${Math.round(activity.total_elevation_gain * 3.281)} ft climb`);
  }
  if (activity.average_heartrate) {
    notesParts.push(`avg HR ${Math.round(activity.average_heartrate)}`);
  }
  const notes = notesParts.join(" · ") || null;

  try {
    const { status } = await upsertEvent({
      sportId,
      type: mapping.type,
      durationMinutes: Math.round((activity.moving_time ?? activity.elapsed_time ?? 0) / 60),
      notes,
      startedAt: activity.start_date,
      source: "strava",
      sourceId: `strava-${activity.id}`,
    });

    if (status === "accepted") result.accepted++;
    else result.skipped++; // already existed — dedup'd
  } catch (err) {
    result.errors.push(`Activity ${activity.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * GET /api/ingest/strava/sync
 * Returns connection status + last sync time.
 */
export async function GET() {
  const tokens = await loadTokens();
  if (!tokens) {
    return NextResponse.json({ connected: false });
  }

  // Reach for last_sync_at.
  const { db: database } = await import("@/db");
  const { ingestConfigs } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await database
    .select({ lastSyncAt: ingestConfigs.lastSyncAt })
    .from(ingestConfigs)
    .where(eq(ingestConfigs.source, "strava"))
    .limit(1);

  return NextResponse.json({
    connected: true,
    athleteName: tokens.athlete_name ?? null,
    athleteId: tokens.athlete_id,
    lastSyncAt: rows[0]?.lastSyncAt ?? null,
  });
}
