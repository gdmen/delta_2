import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { AnyPgDb } from "@/db/types";

/**
 * Duplicate-event candidate pair as surfaced to the UI.
 *
 * "Candidate" here means: two events for the same user, from DIFFERENT
 * sources, started within 60 min of each other, both currently visible,
 * and not in the dismiss-once denylist. The user makes the final
 * "same session?" call per-pair via the Merge / Not-a-duplicate buttons.
 *
 * Same-source pairs are intentionally EXCLUDED. Detection targets one real
 * session recorded by multiple apps. Source-agnostic detection was tried
 * (#41) but flooded the list with same-day, shared-timestamp events from a
 * single strength logger (FitNotes/Fitocracy log many entries per day at one
 * timestamp) that aren't duplicates. Genuine same-source double-recordings
 * (e.g. a Garmin and a Whoop both syncing one ride to Strava) are rare and
 * can be merged by hand — the merge route still permits same-source members.
 *
 * Activity-id equality is intentionally NOT a filter (see issue #4): the
 * source-prefixed activities table means even "same lifting session" pairs have
 * different activity_ids until manually merged. The user picks the composite's
 * activity at merge time.
 */
export interface CandidatePair {
  aId: number;
  aSource: string;
  aActivityId: number;
  aActivityName: string;
  aType: string;
  aStartedAt: string;
  aDurationMinutes: number | null;
  bId: number;
  bSource: string;
  bActivityId: number;
  bActivityName: string;
  bType: string;
  bStartedAt: string;
  bDurationMinutes: number | null;
  /** Absolute minutes between a.started_at and b.started_at. */
  minutesApart: number;
}

const MATCH_WINDOW_MINUTES = 60;
const RECENT_DAYS = 14;

/**
 * Live-query the candidate pairs for one user. Detection is not a
 * stored flag — every render runs this; the denylist + status filters
 * keep the result set bounded.
 *
 * `recent=true` restricts to pairs whose newer member started within
 * the last 14 days. Used for the home-page card. `recent=false`
 * returns the full set; used for /data/duplicates with bulk dismiss.
 *
 * Output is ordered newest-first by a.started_at so the home card
 * leads with what the user just did.
 *
 * Performance shape (post-#25 + the (user_id, started_at) index):
 * - The 60-min match window is expressed as
 *     b.started_at BETWEEN a.started_at - INTERVAL '60 minutes'
 *                      AND a.started_at + INTERVAL '60 minutes'
 *   so the planner recognizes it as a range scan on b.started_at and
 *   uses `idx_events_user_started` for the inner side of the loop.
 *   The functionally-identical `ABS(EXTRACT(EPOCH ...)) <= 60` form
 *   was opaque to the optimizer and forced a self-cross-product.
 * - The `recent=true` filter is a prefilter on BOTH sides (with a 60-min
 *   slop so it doesn't drop legitimate pairs straddling the cutoff —
 *   the join requires |a-b| <= 60min, so if newer >= cutoff, older >=
 *   cutoff - 60min). The post-join GREATEST check stays for exact
 *   correctness — it runs on the tiny result set, not the cross product.
 * - Measured impact on a 3.5K-event single-user dev DB:
 *     recent=true:    1,685 ms → 1.78 ms
 *     recent=false: ~multi-s → 18 ms
 *
 * @param conn Optional drizzle handle. Tests pass an in-memory pglite
 *   instance; prod calls let it default to the postgres-js singleton.
 */
export async function findDuplicateCandidates(
  userId: number,
  opts: { recent?: boolean; limit?: number | null } = {},
  conn: AnyPgDb = db,
): Promise<CandidatePair[]> {
  const recent = opts.recent ?? false;
  // Default to 500 (the /home card). Pass `limit: null` for an unbounded
  // result — the /data/duplicates cleanup queue + bulk routes need EVERY
  // pair so grouping is complete and dismissing a group is monotonic.
  const limit = opts.limit === undefined ? 500 : opts.limit;

  const result = await conn.execute<{
    a_id: number;
    a_source: string;
    a_sport_id: number;
    a_sport_name: string;
    a_type: string;
    a_started_at: string;
    a_duration_minutes: number | null;
    b_id: number;
    b_source: string;
    b_sport_id: number;
    b_sport_name: string;
    b_type: string;
    b_started_at: string;
    b_duration_minutes: number | null;
    minutes_apart: number;
  }>(sql`
    SELECT
      a.id AS a_id, a.source AS a_source, a.activity_id AS a_sport_id,
      sa.name AS a_sport_name, a.type AS a_type, a.started_at AS a_started_at,
      a.duration_minutes AS a_duration_minutes,
      b.id AS b_id, b.source AS b_source, b.activity_id AS b_sport_id,
      sb.name AS b_sport_name, b.type AS b_type, b.started_at AS b_started_at,
      b.duration_minutes AS b_duration_minutes,
      ROUND(
        ABS(EXTRACT(EPOCH FROM (a.started_at - b.started_at)) / 60.0)::numeric,
        1
      ) AS minutes_apart
    FROM events a
    JOIN events b ON a.user_id = b.user_id
                  AND a.id < b.id
                  AND a.source != b.source
                  AND b.started_at BETWEEN
                        a.started_at - INTERVAL '${sql.raw(String(MATCH_WINDOW_MINUTES))} minutes'
                    AND a.started_at + INTERVAL '${sql.raw(String(MATCH_WINDOW_MINUTES))} minutes'
    JOIN activities sa ON sa.id = a.activity_id
    JOIN activities sb ON sb.id = b.activity_id
    WHERE a.user_id = ${userId}
      AND a.status = 'visible'
      AND b.status = 'visible'
      ${recent
        ? sql`
          AND a.started_at >= NOW()
              - INTERVAL '${sql.raw(String(RECENT_DAYS))} days'
              - INTERVAL '${sql.raw(String(MATCH_WINDOW_MINUTES))} minutes'
          AND b.started_at >= NOW()
              - INTERVAL '${sql.raw(String(RECENT_DAYS))} days'
              - INTERVAL '${sql.raw(String(MATCH_WINDOW_MINUTES))} minutes'
          AND GREATEST(a.started_at, b.started_at)
              >= NOW() - INTERVAL '${sql.raw(String(RECENT_DAYS))} days'`
        : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM event_duplicate_denylist d
        WHERE d.user_id = ${userId}
          AND d.event_a_id = LEAST(a.id, b.id)
          AND d.event_b_id = GREATEST(a.id, b.id)
      )
    ORDER BY a.started_at DESC
    ${limit === null ? sql`` : sql`LIMIT ${limit}`}
  `);

  // postgres-js execute() returns the row array directly; pglite returns
  // { rows, ... }. Normalize for driver-agnostic test callers.
  type Row = {
    a_id: number;
    a_source: string;
    a_sport_id: number;
    a_sport_name: string;
    a_type: string;
    a_started_at: string;
    a_duration_minutes: number | null;
    b_id: number;
    b_source: string;
    b_sport_id: number;
    b_sport_name: string;
    b_type: string;
    b_started_at: string;
    b_duration_minutes: number | null;
    minutes_apart: number;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as Row[])
    : ((result as { rows: Row[] }).rows ?? []);

  return rows.map((r) => ({
    aId: r.a_id,
    aSource: r.a_source,
    aActivityId: r.a_sport_id,
    aActivityName: r.a_sport_name,
    aType: r.a_type,
    aStartedAt: r.a_started_at,
    aDurationMinutes: r.a_duration_minutes,
    bId: r.b_id,
    bSource: r.b_source,
    bActivityId: r.b_sport_id,
    bActivityName: r.b_sport_name,
    bType: r.b_type,
    bStartedAt: r.b_started_at,
    bDurationMinutes: r.b_duration_minutes,
    minutesApart: Number(r.minutes_apart),
  }));
}

/**
 * Group a flat candidate list by (source, activity) pair, for the bulk-
 * dismiss UI on /data/duplicates. Order pairs alphabetically within
 * the tuple so `a=fitnotes:biking, b=powerlifting` and the reverse
 * collapse into one group.
 */
export interface CandidateGroup {
  sourceA: string;
  activityNameA: string;
  activityIdA: number;
  sourceB: string;
  activityNameB: string;
  activityIdB: number;
  count: number;
  /** Sample pair ids for display ("e.g. #142 + #143"). Up to 3. */
  sampleIds: { aId: number; bId: number }[];
}

export function groupCandidates(pairs: CandidatePair[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const p of pairs) {
    // Sort the two endpoints so direction doesn't fragment groups.
    const [first, second] =
      p.aActivityName < p.bActivityName ||
      (p.aActivityName === p.bActivityName && p.aSource < p.bSource)
        ? [
            { source: p.aSource, activityName: p.aActivityName, activityId: p.aActivityId },
            { source: p.bSource, activityName: p.bActivityName, activityId: p.bActivityId },
          ]
        : [
            { source: p.bSource, activityName: p.bActivityName, activityId: p.bActivityId },
            { source: p.aSource, activityName: p.aActivityName, activityId: p.aActivityId },
          ];
    const key = `${first.source}|${first.activityId}|${second.source}|${second.activityId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        sourceA: first.source,
        activityNameA: first.activityName,
        activityIdA: first.activityId,
        sourceB: second.source,
        activityNameB: second.activityName,
        activityIdB: second.activityId,
        count: 0,
        sampleIds: [],
      };
      groups.set(key, g);
    }
    g.count++;
    if (g.sampleIds.length < 3) g.sampleIds.push({ aId: p.aId, bId: p.bId });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
