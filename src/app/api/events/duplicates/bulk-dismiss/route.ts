import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventDuplicateDenylist } from "@/db/schema";
import { findDuplicateCandidates } from "@/lib/duplicates/detector";
import { requireUserOr401 } from "@/lib/auth/require";

interface BulkDismissBody {
  /** Source labels of the two endpoints. Order doesn't matter. */
  sourceA: string;
  sportIdA: number;
  sourceB: string;
  sportIdB: number;
}

/**
 * POST /api/events/duplicates/bulk-dismiss
 *
 * Used by the /data/duplicates UI's per-group "Dismiss all N" button.
 * Body: `{ sourceA, sportIdA, sourceB, sportIdB }` — matches one of
 * the source/sport groupings returned by `GET /api/events/duplicates?group=true`.
 *
 * Implementation: re-run the live detector for ALL pairs (not just
 * recent), filter to the matching source/sport tuple in both
 * orientations, and bulk-insert into the denylist. ON CONFLICT DO
 * NOTHING so re-running the same bulk-dismiss is idempotent.
 *
 * Why re-detect rather than join the source-pair criteria into the
 * insert? The candidate query already de-dups against the denylist
 * + status filters — reusing it keeps the source-of-truth in one
 * place. Worst case is a few hundred rows; latency is fine.
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

  if (
    typeof body.sourceA !== "string" ||
    typeof body.sourceB !== "string" ||
    !Number.isInteger(body.sportIdA) ||
    !Number.isInteger(body.sportIdB)
  ) {
    return NextResponse.json(
      { error: "sourceA, sportIdA, sourceB, sportIdB required" },
      { status: 400 },
    );
  }

  const pairs = await findDuplicateCandidates(user.id, { recent: false });

  const matching = pairs.filter((p) => {
    const fwd =
      p.aSource === body.sourceA &&
      p.aSportId === body.sportIdA &&
      p.bSource === body.sourceB &&
      p.bSportId === body.sportIdB;
    const rev =
      p.aSource === body.sourceB &&
      p.aSportId === body.sportIdB &&
      p.bSource === body.sourceA &&
      p.bSportId === body.sportIdA;
    return fwd || rev;
  });

  if (matching.length === 0) {
    return NextResponse.json({ ok: true, dismissed: 0 });
  }

  const rows = matching.map((p) => {
    const [eventAId, eventBId] =
      p.aId < p.bId ? [p.aId, p.bId] : [p.bId, p.aId];
    return { userId: user.id, eventAId, eventBId };
  });

  await db.insert(eventDuplicateDenylist).values(rows).onConflictDoNothing();

  return NextResponse.json({ ok: true, dismissed: rows.length });
}
