import { NextRequest, NextResponse } from "next/server";
import { findDuplicateCandidates, groupCandidates } from "@/lib/duplicates/detector";
import { requireUserOr401 } from "@/lib/auth/require";

/**
 * GET /api/events/duplicates
 *
 * Query params:
 *   recent=true  -> filter to the last 14 days (used by /home card)
 *   group=true   -> return source/activity pair groups (used by /data/duplicates bulk-dismiss UI)
 *
 * Without `group`, returns `{ pairs: CandidatePair[] }`.
 * With `group=true`, returns `{ pairs: CandidatePair[], groups: CandidateGroup[] }`.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const url = new URL(request.url);
  const recent = url.searchParams.get("recent") === "true";
  const group = url.searchParams.get("group") === "true";

  const pairs = await findDuplicateCandidates(user.id, { recent });

  if (group) {
    return NextResponse.json({ pairs, groups: groupCandidates(pairs) });
  }
  return NextResponse.json({ pairs });
}
