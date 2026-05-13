import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface MergeBody {
  aId: number;
  bId: number;
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
 * Folds two visible events into a single composite event. Flips both
 * members to `status='hidden_by_composite'`; the composite itself is a
 * new row with `status='composite'` and the two ids stored in
 * `composite_member_ids`.
 *
 * `started_at` and `ended_at` (currently derived from
 * started_at + duration_minutes — there is no ended_at column today)
 * collapse to the earliest start. Duration is the gap from earliest
 * start to latest "end" across the two members.
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

  if (
    !Number.isInteger(body.aId) ||
    !Number.isInteger(body.bId) ||
    !Number.isInteger(body.sportId) ||
    body.aId === body.bId
  ) {
    return NextResponse.json(
      { error: "aId, bId, sportId required; aId != bId" },
      { status: 400 },
    );
  }

  // Owner-scoped lookup of both members + sport. Ensures the caller
  // owns each ref; prevents a malicious payload from folding a
  // foreign user's event into a composite under our user_id.
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
        inArray(events.id, [body.aId, body.bId]),
      ),
    );
  if (members.length !== 2) {
    return NextResponse.json(
      { error: "Both events must exist and be owned by the caller" },
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
  if (members[0].source === members[1].source) {
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

  // Derive the composite's started_at and durationMinutes. We don't
  // have ended_at as a column, so "end" is started_at + duration when
  // available, else just started_at. Composite's duration covers the
  // full union span.
  const [m1, m2] = members;
  const m1End = m1.durationMinutes
    ? new Date(new Date(m1.startedAt).getTime() + m1.durationMinutes * 60_000).toISOString()
    : m1.startedAt;
  const m2End = m2.durationMinutes
    ? new Date(new Date(m2.startedAt).getTime() + m2.durationMinutes * 60_000).toISOString()
    : m2.startedAt;
  const earliestStart = m1.startedAt < m2.startedAt ? m1.startedAt : m2.startedAt;
  const latestEnd = m1End > m2End ? m1End : m2End;
  const compositeDurationMinutes = Math.max(
    1,
    Math.round((new Date(latestEnd).getTime() - new Date(earliestStart).getTime()) / 60_000),
  );

  const compositeType = body.type ?? m1.type;
  const compositeNotes = body.notes ?? null;

  // sourceId is unique per user — use a synthetic key derived from the
  // member ids so re-creating the same composite (after an unmerge +
  // re-merge) won't collide if the previous composite row was deleted.
  const sortedIds = [body.aId, body.bId].sort((a, b) => a - b);
  const sourceId = `composite-${sortedIds[0]}-${sortedIds[1]}`;

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
