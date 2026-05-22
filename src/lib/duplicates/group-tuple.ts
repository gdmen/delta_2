import type { CandidatePair } from "@/lib/duplicates/detector";

/** One source/sport group tuple, as the /data/duplicates UI groups pairs. */
export interface GroupTuple {
  sourceA: string;
  sportIdA: number;
  sourceB: string;
  sportIdB: number;
}

/**
 * True if the candidate pair belongs to the source/sport group tuple,
 * checked in BOTH orientations.
 *
 * Why both: a raw pair from `findDuplicateCandidates` orders its endpoints
 * by `a.id < b.id` (detector.ts), but `groupCandidates` canonicalizes the
 * group's A/B alphabetically (sportName, then source). Those orderings can
 * be the exact reverse of each other, so a forward-only compare would
 * silently miss ~half the pairs. See issue #35 finding 1.
 */
export function pairMatchesTuple(p: CandidatePair, t: GroupTuple): boolean {
  const fwd =
    p.aSource === t.sourceA &&
    p.aSportId === t.sportIdA &&
    p.bSource === t.sourceB &&
    p.bSportId === t.sportIdB;
  const rev =
    p.aSource === t.sourceB &&
    p.aSportId === t.sportIdB &&
    p.bSource === t.sourceA &&
    p.bSportId === t.sportIdA;
  return fwd || rev;
}

export function isValidTuple(t: unknown): t is GroupTuple {
  if (typeof t !== "object" || t === null) return false;
  const g = t as Record<string, unknown>;
  return (
    typeof g.sourceA === "string" &&
    typeof g.sourceB === "string" &&
    Number.isInteger(g.sportIdA) &&
    Number.isInteger(g.sportIdB)
  );
}
