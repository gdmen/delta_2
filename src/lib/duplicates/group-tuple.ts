import type { CandidatePair } from "@/lib/duplicates/detector";

/** One source/activity group tuple, as the /data/duplicates UI groups pairs. */
export interface GroupTuple {
  sourceA: string;
  activityIdA: number;
  sourceB: string;
  activityIdB: number;
}

/**
 * True if the candidate pair belongs to the source/activity group tuple,
 * checked in BOTH orientations.
 *
 * Why both: a raw pair from `findDuplicateCandidates` orders its endpoints
 * by `a.id < b.id` (detector.ts), but `groupCandidates` canonicalizes the
 * group's A/B alphabetically (activityName, then source). Those orderings can
 * be the exact reverse of each other, so a forward-only compare would
 * silently miss ~half the pairs. See issue #35 finding 1.
 */
export function pairMatchesTuple(p: CandidatePair, t: GroupTuple): boolean {
  const fwd =
    p.aSource === t.sourceA &&
    p.aActivityId === t.activityIdA &&
    p.bSource === t.sourceB &&
    p.bActivityId === t.activityIdB;
  const rev =
    p.aSource === t.sourceB &&
    p.aActivityId === t.activityIdB &&
    p.bSource === t.sourceA &&
    p.bActivityId === t.activityIdA;
  return fwd || rev;
}

export function isValidTuple(t: unknown): t is GroupTuple {
  if (typeof t !== "object" || t === null) return false;
  const g = t as Record<string, unknown>;
  return (
    typeof g.sourceA === "string" &&
    typeof g.sourceB === "string" &&
    Number.isInteger(g.activityIdA) &&
    Number.isInteger(g.activityIdB)
  );
}
