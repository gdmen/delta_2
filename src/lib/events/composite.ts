import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";

export type CreateCompositeResult =
  | { ok: true; id: number }
  | { ok: false; status: number; error: string };

export interface CreateCompositeInput {
  sportId: number;
  /** Defaults to the first member's type. */
  type?: string;
  /** ISO timestamp; defaults to the earliest member's start. */
  startedAt?: string;
  /** Explicit value (including null) wins; `undefined` → computed span
   * between earliest member start and latest member end. */
  durationMinutes?: number | null;
  notes?: string | null;
}

/**
 * Fold one or more visible member events into a composite: insert a
 * `status='composite'` row that references the members via
 * `composite_member_ids`, then flip the members to
 * `status='hidden_by_composite'` (kept, not deleted — exports still see
 * them). Members may share a `source`.
 *
 * Shared by POST /api/events/merge (one composite, user-tuned in the
 * modal) and the duplicates bulk-merge route (many composites,
 * auto-defaulted). The CALLER owns HTTP-shape validation (memberIds
 * non-empty / integer / distinct, startedAt + durationMinutes well-formed);
 * this does the ownership + status + sport-ownership checks and the DB
 * mutation, returning a typed result the caller maps to a response.
 */
export async function createComposite(
  userId: number,
  memberIds: number[],
  input: CreateCompositeInput,
): Promise<CreateCompositeResult> {
  const members = await db
    .select({
      id: events.id,
      type: events.type,
      startedAt: events.startedAt,
      durationMinutes: events.durationMinutes,
      status: events.status,
    })
    .from(events)
    .where(and(userScope(userId).events, inArray(events.id, memberIds)));

  if (members.length !== memberIds.length) {
    return {
      ok: false,
      status: 404,
      error: "Member event(s) must exist and be owned by the caller",
    };
  }
  for (const m of members) {
    if (m.status !== "visible") {
      return {
        ok: false,
        status: 409,
        error: `Event ${m.id} has status='${m.status}'; only 'visible' events can be merged`,
      };
    }
  }

  const ownsSport = await db
    .select({ id: sports.id })
    .from(sports)
    .where(and(userScope(userId).sports, eq(sports.id, input.sportId)))
    .limit(1);
  if (ownsSport.length === 0) {
    return { ok: false, status: 400, error: "sportId not found" };
  }

  const earliestStart = members.reduce(
    (acc, m) => (m.startedAt < acc ? m.startedAt : acc),
    members[0].startedAt,
  );

  const startedAt = input.startedAt ?? earliestStart;

  let durationMinutes: number | null;
  if (input.durationMinutes !== undefined) {
    durationMinutes = input.durationMinutes;
  } else {
    // Computed span: earliest member start → latest member end.
    const ends = members.map((m) =>
      m.durationMinutes
        ? new Date(
            new Date(m.startedAt).getTime() + m.durationMinutes * 60_000,
          ).toISOString()
        : m.startedAt,
    );
    const latestEnd = ends.reduce((acc, e) => (e > acc ? e : acc), ends[0]);
    durationMinutes = Math.max(
      1,
      Math.round(
        (new Date(latestEnd).getTime() - new Date(earliestStart).getTime()) /
          60_000,
      ),
    );
  }

  const type = input.type ?? members[0].type;
  // sourceId is unique per user — synthesize from sorted member ids.
  const sortedIds = [...memberIds].sort((a, b) => a - b);
  const sourceId = `composite-${sortedIds.join("-")}`;

  const inserted = await db
    .insert(events)
    .values({
      userId,
      sportId: input.sportId,
      type,
      durationMinutes,
      notes: input.notes ?? null,
      startedAt,
      source: "composite",
      sourceId,
      status: "composite",
      compositeMemberIds: sortedIds,
    })
    .returning({ id: events.id });

  await db
    .update(events)
    .set({ status: "hidden_by_composite" })
    .where(and(userScope(userId).events, inArray(events.id, sortedIds)));

  return { ok: true, id: inserted[0].id };
}
