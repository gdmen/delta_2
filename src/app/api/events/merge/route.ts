import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface MergeBody {
  /** Required. First (or only) member event. */
  aId: number;
  /**
   * Optional second member. Omit to create a single-member composite
   * — used to wrap one event with a corrected canonical sport
   * (e.g. retag a Strava `Workout` row as BJJ while keeping the
   * Strava heart-rate data accessible via the composite's Sources
   * panel).
   */
  bId?: number;
  /** Sport for the composite. Must belong to the calling user. */
  sportId: number;
  /** Optional override of the composite's display type (defaults to a's). */
  type?: string;
  /** Optional free-form notes on the merge. */
  notes?: string | null;
}

/**
 * POST /api/events/merge
 *
 * Folds one or two visible events into a single composite event.
 * Members flip to `status='hidden_by_composite'`; the composite is a
 * new row with `status='composite'` and the member ids stored in
 * `composite_member_ids`.
 *
 * Two flavors:
 *   - **Two-member merge** — typical "same physical session logged
 *     twice" case. Different sources required.
 *   - **Single-member promote** — wrap one event with a corrected
 *     canonical sport. Useful when a source emits a generic activity
 *     type (Strava `Workout`) but the user knows what it actually was.
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

  if (!Number.isInteger(body.aId) || !Number.isInteger(body.sportId)) {
    return NextResponse.json(
      { error: "aId and sportId are required" },
      { status: 400 },
    );
  }
  const memberIdsRequested =
    body.bId !== undefined && body.bId !== null ? [body.aId, body.bId] : [body.aId];
  if (
    memberIdsRequested.length === 2 &&
    (!Number.isInteger(memberIdsRequested[1]) || memberIdsRequested[0] === memberIdsRequested[1])
  ) {
    return NextResponse.json(
      { error: "When provided, bId must be an integer distinct from aId" },
      { status: 400 },
    );
  }

  // Owner-scoped lookup of the member event(s) + sport. Ensures the
  // caller owns each ref.
  const members = await db
    .select({
      id: events.id,
      sportId: events.sportId,
      type: events.type,
      startedAt: events.startedAt,
      durationMinutes: events.durationMinutes,
      status: events.status,
      source: events.source,
    })
    .from(events)
    .where(
      and(
        userScope(user.id).events,
        inArray(events.id, memberIdsRequested),
      ),
    );
  if (members.length !== memberIdsRequested.length) {
    return NextResponse.json(
      { error: "Member event(s) must exist and be owned by the caller" },
      { status: 404 },
    );
  }
  for (const m of members) {
    if (m.status !== "visible") {
      return NextResponse.json(
        { error: `Event ${m.id} has status='${m.status}'; only 'visible' events can be merged` },
        { status: 409 },
      );
    }
  }
  if (members.length === 2 && members[0].source === members[1].source) {
    return NextResponse.json(
      { error: "Both events have the same source; merging same-source events isn't supported" },
      { status: 409 },
    );
  }

  const ownsSport = await db
    .select({ id: sports.id })
    .from(sports)
    .where(and(userScope(user.id).sports, eq(sports.id, body.sportId)))
    .limit(1);
  if (ownsSport.length === 0) {
    return NextResponse.json({ error: "sportId not found" }, { status: 400 });
  }

  // Span derivation: earliest start, latest "end" (= start + duration
  // when available, else just start). Single-member composite collapses
  // to the member's own start + duration.
  const ends = members.map((m) =>
    m.durationMinutes
      ? new Date(new Date(m.startedAt).getTime() + m.durationMinutes * 60_000).toISOString()
      : m.startedAt,
  );
  const earliestStart = members.reduce((acc, m) =>
    m.startedAt < acc ? m.startedAt : acc,
    members[0].startedAt,
  );
  const latestEnd = ends.reduce((acc, e) => (e > acc ? e : acc), ends[0]);
  const compositeDurationMinutes = Math.max(
    1,
    Math.round((new Date(latestEnd).getTime() - new Date(earliestStart).getTime()) / 60_000),
  );

  const compositeType = body.type ?? members[0].type;
  const compositeNotes = body.notes ?? null;

  // sourceId is unique per user — synthesize from sorted member ids.
  const sortedIds = [...memberIdsRequested].sort((a, b) => a - b);
  const sourceId = `composite-${sortedIds.join("-")}`;

  const inserted = await db
    .insert(events)
    .values({
      userId: user.id,
      sportId: body.sportId,
      type: compositeType,
      durationMinutes: compositeDurationMinutes,
      notes: compositeNotes,
      startedAt: earliestStart,
      source: "composite",
      sourceId,
      status: "composite",
      compositeMemberIds: sortedIds,
    })
    .returning({ id: events.id });

  await db
    .update(events)
    .set({ status: "hidden_by_composite" })
    .where(
      and(
        userScope(user.id).events,
        inArray(events.id, sortedIds),
      ),
    );

  return NextResponse.json({ id: inserted[0].id });
}
