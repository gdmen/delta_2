import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Duplicate-event candidate pair as surfaced to the UI.
 *
 * "Candidate" here means: two events for the same user, from different
 * sources, started within 60 min of each other, both currently visible,
 * and not in the dismiss-once denylist. The user makes the final
 * "same session?" call per-pair via the Merge / Not-a-duplicate buttons.
 *
 * Sport-id equality is intentionally NOT a filter (see issue #4): the
 * source-prefixed sports table means even "same lifting session" pairs
 * have different sport_ids until manually merged. The user picks the
 * composite's sport at merge time.
 */
export interface CandidatePair {
  aId: number;
  aSource: string;
  aSportId: number;
  aSportName: string;
  aType: string;
  aStartedAt: string;
  aDurationMinutes: number | null;
  bId: number;
  bSource: string;
  bSportId: number;
  bSportName: string;
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
 */
export async function findDuplicateCandidates(
  userId: number,
  opts: { recent?: boolean; limit?: number } = {},
): Promise<CandidatePair[]> {
  const recent = opts.recent ?? false;
  const limit = opts.limit ?? 500;

  const rows = await db.execute<{
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
      a.id AS a_id, a.source AS a_source, a.sport_id AS a_sport_id,
      sa.name AS a_sport_name, a.type AS a_type, a.started_at AS a_started_at,
      a.duration_minutes AS a_duration_minutes,
      b.id AS b_id, b.source AS b_source, b.sport_id AS b_sport_id,
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
                  AND ABS(
                    EXTRACT(EPOCH FROM (a.started_at - b.started_at)) / 60.0
                  ) <= ${MATCH_WINDOW_MINUTES}
    JOIN sports sa ON sa.id = a.sport_id
    JOIN sports sb ON sb.id = b.sport_id
    WHERE a.user_id = ${userId}
      AND a.status = 'visible'
      AND b.status = 'visible'
      ${recent
        ? sql`AND GREATEST(a.started_at, b.started_at) >= NOW() - INTERVAL '${sql.raw(String(RECENT_DAYS))} days'`
        : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM event_duplicate_denylist d
        WHERE d.user_id = ${userId}
          AND d.event_a_id = LEAST(a.id, b.id)
          AND d.event_b_id = GREATEST(a.id, b.id)
      )
    ORDER BY a.started_at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    aId: r.a_id,
    aSource: r.a_source,
    aSportId: r.a_sport_id,
    aSportName: r.a_sport_name,
    aType: r.a_type,
    aStartedAt: r.a_started_at,
    aDurationMinutes: r.a_duration_minutes,
    bId: r.b_id,
    bSource: r.b_source,
    bSportId: r.b_sport_id,
    bSportName: r.b_sport_name,
    bType: r.b_type,
    bStartedAt: r.b_started_at,
    bDurationMinutes: r.b_duration_minutes,
    minutesApart: Number(r.minutes_apart),
  }));
}

/**
 * Group a flat candidate list by (source, sport) pair, for the bulk-
 * dismiss UI on /data/duplicates. Order pairs alphabetically within
 * the tuple so `a=fitnotes:biking, b=powerlifting` and the reverse
 * collapse into one group.
 */
export interface CandidateGroup {
  sourceA: string;
  sportNameA: string;
  sportIdA: number;
  sourceB: string;
  sportNameB: string;
  sportIdB: number;
  count: number;
  /** Sample pair ids for display ("e.g. #142 + #143"). Up to 3. */
  sampleIds: { aId: number; bId: number }[];
}

export function groupCandidates(pairs: CandidatePair[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const p of pairs) {
    // Sort the two endpoints so direction doesn't fragment groups.
    const [first, second] =
      p.aSportName < p.bSportName ||
      (p.aSportName === p.bSportName && p.aSource < p.bSource)
        ? [
            { source: p.aSource, sportName: p.aSportName, sportId: p.aSportId },
            { source: p.bSource, sportName: p.bSportName, sportId: p.bSportId },
          ]
        : [
            { source: p.bSource, sportName: p.bSportName, sportId: p.bSportId },
            { source: p.aSource, sportName: p.aSportName, sportId: p.aSportId },
          ];
    const key = `${first.source}|${first.sportId}|${second.source}|${second.sportId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        sourceA: first.source,
        sportNameA: first.sportName,
        sportIdA: first.sportId,
        sourceB: second.source,
        sportNameB: second.sportName,
        sportIdB: second.sportId,
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
