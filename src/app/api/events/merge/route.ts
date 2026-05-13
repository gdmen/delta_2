import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface MergeBody {
  /**
   * One or more member event ids. The composite wraps all of them.
   *
   * - N=1 is a "promote" — wrap one event with a corrected canonical
   *   sport (e.g. retag a Strava `Workout` row as BJJ).
   * - N=2 is the typical "same session logged twice" merge.
   * - N≥3 covers multi-source single sessions (Strava + Apple Health
   *   + Whoop all reporting the same morning lift).
   *
   * No two members may share a `source` — composites combine
   * cross-source data; two events from the same source for the same
   * time are almost always one being a duplicate-import rather than
   * truly distinct sessions.
   */
  memberIds: number[];
  /** Sport for the composite. Must belong to the calling user. */
  sportId: number;
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

  if (!Number.isInteger(body.sportId)) {
    return NextResponse.json(
      { error: "sportId is required" },
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
  // No two members may share a source. Generalizes the prior 2-member
  // check to N members; finds the first colliding pair for a helpful
  // error.
  if (members.length > 1) {
    const seen = new Map<string, number>();
    for (const m of members) {
      const prevId = seen.get(m.source);
      if (prevId !== undefined) {
        return NextResponse.json(
          {
            error: `Events ${prevId} and ${m.id} share source='${m.source}'; merging same-source events isn't supported`,
          },
          { status: 409 },
        );
      }
      seen.set(m.source, m.id);
    }
  }

  const ownsSport = await db
    .select({ id: sports.id })
    .from(sports)
    .where(and(userScope(user.id).sports, eq(sports.id, body.sportId)))
    .limit(1);
  if (ownsSport.length === 0) {
    return NextResponse.json({ error: "sportId not found" }, { status: 400 });
  }

  // started_at: caller override wins, else earliest member start.
  let compositeStartedAt: string;
  if (body.startedAt !== undefined) {
    const parsed = new Date(body.startedAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "startedAt must be a valid ISO timestamp" },
        { status: 400 },
      );
    }
    compositeStartedAt = parsed.toISOString();
  } else {
    compositeStartedAt = members.reduce(
      (acc, m) => (m.startedAt < acc ? m.startedAt : acc),
      members[0].startedAt,
    );
  }

  // duration: caller override wins (including explicit null), else
  // computed span between earliest member start and latest member end.
  let compositeDurationMinutes: number | null;
  if (body.durationMinutes !== undefined) {
    if (body.durationMinutes === null) {
      compositeDurationMinutes = null;
    } else if (
      !Number.isFinite(body.durationMinutes) ||
      body.durationMinutes < 1
    ) {
      return NextResponse.json(
        { error: "durationMinutes must be null or a positive number" },
        { status: 400 },
      );
    } else {
      compositeDurationMinutes = Math.round(body.durationMinutes);
    }
  } else {
    const earliestStart = members.reduce(
      (acc, m) => (m.startedAt < acc ? m.startedAt : acc),
      members[0].startedAt,
    );
    const ends = members.map((m) =>
      m.durationMinutes
        ? new Date(new Date(m.startedAt).getTime() + m.durationMinutes * 60_000).toISOString()
        : m.startedAt,
    );
    const latestEnd = ends.reduce((acc, e) => (e > acc ? e : acc), ends[0]);
    compositeDurationMinutes = Math.max(
      1,
      Math.round((new Date(latestEnd).getTime() - new Date(earliestStart).getTime()) / 60_000),
    );
  }

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
      startedAt: compositeStartedAt,
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
