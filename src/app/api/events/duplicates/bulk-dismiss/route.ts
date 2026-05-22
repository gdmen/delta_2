import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventDuplicateDenylist } from "@/db/schema";
import { findDuplicateCandidates } from "@/lib/duplicates/detector";
import {
  isValidTuple,
  pairMatchesTuple,
  type GroupTuple,
} from "@/lib/duplicates/group-tuple";
import { requireUserOr401 } from "@/lib/auth/require";

interface BulkDismissBody {
  /** Source/sport group tuples to dismiss, from the multi-select UI. */
  groups: GroupTuple[];
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
