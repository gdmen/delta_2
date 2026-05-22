import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventDuplicateDenylist } from "@/db/schema";
import {
  findDuplicateCandidates,
  type CandidatePair,
} from "@/lib/duplicates/detector";
import { requireUserOr401 } from "@/lib/auth/require";

/** One source/sport group tuple, as the /data/duplicates UI groups pairs. */
interface GroupTuple {
  sourceA: string;
  sportIdA: number;
  sourceB: string;
  sportIdB: number;
}

interface BulkDismissBody {
  /** Source/sport group tuples to dismiss, from the multi-select UI. */
  groups: GroupTuple[];
}

/**
 * True if the candidate pair belongs to the source/sport group tuple,
 * checked in BOTH orientations.
 *
 * Why both: a raw pair from `findDuplicateCandidates` orders its
 * endpoints by `a.id < b.id` (detector.ts), but `groupCandidates`
 * canonicalizes the group's A/B alphabetically (sportName, then
 * source). Those orderings can be the exact reverse of each other, so
 * a forward-only compare would silently miss ~half the pairs and
 * dismiss nothing. See issue #35 finding 1.
 */
function pairMatchesTuple(p: CandidatePair, t: GroupTuple): boolean {
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

function isValidTuple(t: unknown): t is GroupTuple {
  if (typeof t !== "object" || t === null) return false;
  const g = t as Record<string, unknown>;
  return (
    typeof g.sourceA === "string" &&
    typeof g.sourceB === "string" &&
    Number.isInteger(g.sportIdA) &&
    Number.isInteger(g.sportIdB)
  );
}

/**
 * POST /api/events/duplicates/bulk-dismiss
 *
 * Multi-group dismiss for the /data/duplicates page. Body:
 * `{ groups: [{ sourceA, sportIdA, sourceB, sportIdB }, ...] }`.
 *
 * Implementation: re-run the live detector ONCE for all (non-recent)
 * pairs, then keep any pair that matches ANY selected tuple in either
 * orientation (the loop — see `pairMatchesTuple` + #35). Bulk-insert
 * the matches into the denylist, ON CONFLICT DO NOTHING so re-running
 * is idempotent.
 *
 * Per-user scoped: `findDuplicateCandidates(user.id, …)` only ever
 * returns this user's pairs, and the denylist rows carry `user.id`.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: BulkDismissBody;
  try {
    body = (await request.json()) as BulkDismissBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.groups) || body.groups.length === 0) {
    return NextResponse.json(
      { error: "groups must be a non-empty array of {sourceA, sportIdA, sourceB, sportIdB}" },
      { status: 400 },
    );
  }
  if (!body.groups.every(isValidTuple)) {
    return NextResponse.json(
      { error: "each group needs sourceA, sportIdA, sourceB, sportIdB" },
      { status: 400 },
    );
  }
  const tuples = body.groups;

  // One detector pass; filter to pairs matching any selected tuple.
  const pairs = await findDuplicateCandidates(user.id, { recent: false });
  const matching = pairs.filter((p) => tuples.some((t) => pairMatchesTuple(p, t)));

  if (matching.length === 0) {
    return NextResponse.json({ ok: true, dismissed: 0 });
  }

  const rows = matching.map((p) => {
    const [eventAId, eventBId] = p.aId < p.bId ? [p.aId, p.bId] : [p.bId, p.aId];
    return { userId: user.id, eventAId, eventBId };
  });

  await db.insert(eventDuplicateDenylist).values(rows).onConflictDoNothing();

  return NextResponse.json({ ok: true, dismissed: rows.length });
}
