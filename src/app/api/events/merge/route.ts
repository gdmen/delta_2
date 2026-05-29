import { NextRequest, NextResponse } from "next/server";
import { requireUserOr401 } from "@/lib/auth/require";
import { createComposite } from "@/lib/events/composite";

interface MergeBody {
  /**
   * One or more member event ids. The composite wraps all of them.
   *
   * - N=1 is a "promote" — wrap one event with a corrected canonical
   *   activity (e.g. retag a Strava `Workout` row as BJJ).
   * - N=2 is the typical "same session logged twice" merge.
   * - N≥3 covers multi-source single sessions (Strava + Apple Health
   *   + Whoop all reporting the same morning lift).
   *
   * Members MAY share a `source`. `source` is the sync/integration layer
   * (e.g. strava), not the recording device — two devices both pushing to
   * one integration (a Garmin and a Whoop syncing the same ride to
   * Strava) produce two `source='strava'` events for one real session,
   * which is a legitimate composite.
   */
  memberIds: number[];
  /** Activity for the composite. Must belong to the calling user. */
  activityId: number;
  /** Optional override of the composite's display type (defaults to first member's). */
  type?: string;
  /** Optional free-form notes on the merge. */
  notes?: string | null;
  /**
   * Optional ISO timestamp override for the composite's started_at.
   * When omitted, defaults to the earliest member's started_at.
   */
  startedAt?: string;
  /**
   * Optional duration override in minutes. When omitted, falls back to
   * the auto-computed span between earliest start and latest end —
   * which is fine for clean cross-source merges but can produce wacky
   * values when member timestamps are off by an hour (clock skew,
   * timezone bugs in the source). UI defaults to max(member durations)
   * which is closer to the user's intent. Pass `null` to leave the
   * composite with null duration.
   */
  durationMinutes?: number | null;
}

/**
 * POST /api/events/merge
 *
 * Folds one or more visible events into a single composite event.
 * Members flip to `status='hidden_by_composite'`; the composite is a
 * new row with `status='composite'` and the member ids stored in
 * `composite_member_ids`.
 *
 * Members aren't deleted: exports and diagnostics still see them. Only
 * default views filter `status = 'visible'`.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: MergeBody;
  try {
    body = (await request.json()) as MergeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Number.isInteger(body.activityId)) {
    return NextResponse.json(
      { error: "activityId is required" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(body.memberIds) ||
    body.memberIds.length === 0 ||
    !body.memberIds.every((id) => Number.isInteger(id))
  ) {
    return NextResponse.json(
      { error: "memberIds must be a non-empty array of integers" },
      { status: 400 },
    );
  }
  const memberIdsRequested = body.memberIds;
  if (new Set(memberIdsRequested).size !== memberIdsRequested.length) {
    return NextResponse.json(
      { error: "memberIds must not contain duplicates" },
      { status: 400 },
    );
  }

  // Validate the optional started_at / duration overrides here (HTTP
  // shape); createComposite applies the earliest-start + computed-span
  // defaults when they're omitted, and does the ownership/status/activity
  // checks + the DB mutation.
  let startedAtOverride: string | undefined;
  if (body.startedAt !== undefined) {
    const parsed = new Date(body.startedAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "startedAt must be a valid ISO timestamp" },
        { status: 400 },
      );
    }
    startedAtOverride = parsed.toISOString();
  }

  let durationOverride: number | null | undefined;
  if (body.durationMinutes !== undefined) {
    if (body.durationMinutes === null) {
      durationOverride = null;
    } else if (
      !Number.isFinite(body.durationMinutes) ||
      body.durationMinutes < 1
    ) {
      return NextResponse.json(
        { error: "durationMinutes must be null or a positive number" },
        { status: 400 },
      );
    } else {
      durationOverride = Math.round(body.durationMinutes);
    }
  }

  const result = await createComposite(user.id, memberIdsRequested, {
    activityId: body.activityId,
    type: body.type,
    startedAt: startedAtOverride,
    durationMinutes: durationOverride,
    notes: body.notes ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.id });
}
