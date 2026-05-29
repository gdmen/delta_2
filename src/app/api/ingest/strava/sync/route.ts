import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ingestConfigs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { iterateActivities, loadTokens, touchLastSync, StravaActivity } from "@/lib/strava/client";
import { upsertEvent, upsertEventMetric } from "@/lib/ingest-service";
import {
  buildMetricTypeCache,
  resolveMetricTypeId,
  MetricTypeCache,
} from "@/lib/ingest/metric-resolver";
import { buildActivityCache, resolveActivityId, ActivityCache } from "@/lib/ingest/activity-resolver";
import { ReconcileTracker } from "@/lib/reconcile";

// Strava emits SI (meters). distance_km for the canonical metric;
// miles + feet for the notes string (user preference).
const METERS_TO_KM = 1 / 1000;
const METERS_TO_MILES = 1 / 1609.344;
const METERS_TO_FEET = 3.28084;

export const maxDuration = 120;

interface SyncBody {
  after?: string; // ISO date. Default: since last sync, or 0 (all history) if never synced.
  mode?: "incremental" | "backfill";
}

interface SyncResult {
  fetched: number;
  accepted: number;
  skipped: number;
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
  // /api/ingest/* is exempt from the proxy session-cookie gate, so
  // we ask Auth.js directly. The Strava sync is user-initiated (UI
  // button click) so the session cookie is present.
  const session = await auth();
  const userIdStr = session?.user?.id;
  const userId = userIdStr ? parseInt(userIdStr, 10) : NaN;
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const tokens = await loadTokens(userId);
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

  // Activity cache feeds resolveActivityId; metric_type cache attaches
  // canonical per-event metrics (distance_km, elevation_gain_m, etc.).
  // Activity names that don't already exist auto-create as `strava:<activity_type>`
  // — see src/lib/ingest/activity-resolver.ts for the rationale.
  const activityCache = await buildActivityCache(userId);
  const typeCache = await buildMetricTypeCache(userId);

  const result: SyncResult = {
    fetched: 0,
    accepted: 0,
    skipped: 0,
    errors: [],
  };

  const tracker = new ReconcileTracker(userId);

  try {
    for await (const activity of iterateActivities(userId, afterUnix)) {
      result.fetched++;
      await ingestOne(userId, activity, activityCache, typeCache, result, tracker);
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return NextResponse.json(result, { status: 500 });
  }

  // Strava's list API is authoritative for [after, now]. Force the
  // reconcile range to cover that entire window so a deletion of the most
  // recent activity (which sits past the upserted max) still gets caught.
  tracker.setEventRange(
    new Date(afterUnix * 1000).toISOString(),
    new Date().toISOString()
  );
  const reconcile = await tracker.apply("strava");

  await touchLastSync(userId);

  return NextResponse.json({ ...result, reconcile });
}

async function ingestOne(
  userId: number,
  activity: StravaActivity,
  activityCache: ActivityCache,
  typeCache: MetricTypeCache,
  result: SyncResult,
  tracker: ReconcileTracker,
): Promise<void> {
  // Strava's `activity_type` is newer/more specific than `type`; prefer it
  // when present. Falling back to `type` covers older activities that
  // predate the activity_type field.
  const rawActivity = activity.activity_type ?? activity.type;
  if (!rawActivity) {
    result.skipped++;
    return;
  }

  // Auto-create the activity if it's never been seen. The user merges
  // `strava:Ride` etc. into canonical names via /data/activities.
  const activityId = await resolveActivityId({
    rawName: rawActivity,
    sourceSystem: "strava",
    cache: activityCache,
  });

  // Compose notes from activity metadata that doesn't fit the schema columns.
  const notesParts: string[] = [];
  if (activity.name) notesParts.push(activity.name);
  if (activity.distance) {
    notesParts.push(`${(activity.distance * METERS_TO_MILES).toFixed(2)} mi`);
  }
  if (activity.total_elevation_gain) {
    notesParts.push(
      `${Math.round(activity.total_elevation_gain * METERS_TO_FEET)} ft climb`,
    );
  }
  if (activity.average_heartrate) {
    notesParts.push(`avg HR ${Math.round(activity.average_heartrate)}`);
  }
  const notes = notesParts.join(" · ") || null;

  try {
    const sourceId = `strava-${activity.id}`;
    const { status, eventId } = await upsertEvent({
      
      userId,
      activityId,
      // Raw Strava activity_type / type goes into events.type verbatim.
      // No canonical translation — events.type is a free-text label.
      type: rawActivity,
      durationMinutes: Math.round((activity.moving_time ?? activity.elapsed_time ?? 0) / 60),
      notes,
      startedAt: activity.start_date,
      source: "strava",
      sourceId,
    });
    tracker.recordEvent(sourceId, activity.start_date);

    // Attach per-event metrics. Routes through the orphan-first
    // resolver so first sync auto-creates `strava:distance_km` etc.
    // and the user merges into preferred canonical names via
    // /data/metrics. Upsert is keyed on (eventId, metricTypeId) so
    // re-syncs refresh values rather than duplicating.
    const attach: Array<[rawName: string, unit: string, value: number]> = [];
    if (Number.isFinite(activity.distance)) {
      attach.push(["distance_km", "km", Number((activity.distance * METERS_TO_KM).toFixed(3))]);
    }
    if (typeof activity.total_elevation_gain === "number") {
      attach.push(["elevation_gain_m", "m", Math.round(activity.total_elevation_gain)]);
    }
    if (typeof activity.average_heartrate === "number") {
      attach.push(["avg_hr", "bpm", Math.round(activity.average_heartrate)]);
    }
    if (typeof activity.max_heartrate === "number") {
      attach.push(["max_hr", "bpm", Math.round(activity.max_heartrate)]);
    }
    for (const [rawName, unit, value] of attach) {
      const { id } = await resolveMetricTypeId({
        rawName,
        map: {},
        sourceSystem: "strava",
        unit,
        cache: typeCache,
      });
      await upsertEventMetric(eventId, id, value);
    }

    if (status === "accepted") result.accepted++;
    else result.skipped++; // already existed - deduped
  } catch (err) {
    result.errors.push(`Activity ${activity.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * GET /api/ingest/strava/sync
 * Returns connection status + last sync time FOR THE CALLER.
 *
 * Hardcoded user_id=1 was the bug shipped in PR2 phase 4 — the proxy
 * exempts /api/ingest/* from the cookie gate (so the HAE bearer path
 * works), which made this GET an unauthenticated cross-user oracle
 * for the owner's Strava identity. Now requires a session and scopes
 * both the token-load AND the lastSyncAt SELECT to the caller.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ? parseInt(session.user.id, 10) : NaN;
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const tokens = await loadTokens(userId);
  if (!tokens) {
    return NextResponse.json({ connected: false });
  }

  const rows = await db
    .select({ lastSyncAt: ingestConfigs.lastSyncAt })
    .from(ingestConfigs)
    .where(
      and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "strava")),
    )
    .limit(1);

  return NextResponse.json({
    connected: true,
    athleteName: tokens.athlete_name ?? null,
    athleteId: tokens.athlete_id,
    lastSyncAt: rows[0]?.lastSyncAt ?? null,
  });
}
