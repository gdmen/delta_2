import { NextRequest, NextResponse } from "next/server";
import { findDuplicateCandidates } from "@/lib/duplicates/detector";
import {
  isValidTuple,
  pairMatchesTuple,
  type GroupTuple,
} from "@/lib/duplicates/group-tuple";
import { createComposite } from "@/lib/events/composite";
import { requireUserOr401 } from "@/lib/auth/require";

interface BulkMergeBody {
  /** The ONE source/activity group to merge. The UI only enables bulk merge
   * when exactly one group is selected — multiple groups would each need
   * their own composite activity, so they stay dismiss-only. */
  group: GroupTuple;
  /** The composite activity to apply to every composite created here. */
  activityId: number;
}

/**
 * POST /api/events/duplicates/bulk-merge
 *
 * Merge every candidate pair in ONE source/activity group into composites.
 * Body: `{ group: {sourceA, activityIdA, sourceB, activityIdB}, activityId }`.
 *
 * Re-runs the live detector, keeps the pairs matching the group (either
 * orientation), then CLUSTERS them: events transitively linked by pairs
 * form one connected component, merged into a single composite. That's
 * what makes a session recorded 3 times (e.g. two Whoop recordings near
 * one Strava ride) collapse into one composite instead of failing on the
 * second pair-merge (an event can only be folded once). Every composite
 * uses `activityId`, the earliest member's start, and the max member
 * duration (matching the per-pair modal's default).
 *
 * Per-user scoped: the detector only returns this user's pairs, and
 * createComposite re-checks ownership.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: BulkMergeBody;
  try {
    body = (await request.json()) as BulkMergeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidTuple(body.group)) {
    return NextResponse.json(
      { error: "group must be {sourceA, activityIdA, sourceB, activityIdB}" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(body.activityId)) {
    return NextResponse.json({ error: "activityId is required" }, { status: 400 });
  }
  const group = body.group;

  // One detector pass; keep the pairs in this group. No limit — must see
  // every pair so the whole group merges, not just its first 500.
  const pairs = await findDuplicateCandidates(user.id, {
    recent: false,
    limit: null,
  });
  const matching = pairs.filter((p) => pairMatchesTuple(p, group));
  if (matching.length === 0) {
    return NextResponse.json({ ok: true, merged: 0, events: 0 });
  }

  // Union-find over the matched pairs' event ids → connected components.
  const parent = new Map<number, number>();
  const durByEvent = new Map<number, number | null>();
  const see = (id: number, dur: number | null) => {
    if (!parent.has(id)) parent.set(id, id);
    if (!durByEvent.has(id)) durByEvent.set(id, dur);
  };
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // Path-compress.
    let cur = x;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of matching) {
    see(p.aId, p.aDurationMinutes);
    see(p.bId, p.bDurationMinutes);
    union(p.aId, p.bId);
  }

  const components = new Map<number, number[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    let comp = components.get(root);
    if (!comp) {
      comp = [];
      components.set(root, comp);
    }
    comp.push(id);
  }

  let merged = 0;
  let eventsMerged = 0;
  for (const memberIds of components.values()) {
    if (memberIds.length < 2) continue; // every event came from a pair, but guard anyway
    const durs = memberIds
      .map((id) => durByEvent.get(id) ?? null)
      .filter((d): d is number => d !== null);
    const durationMinutes = durs.length > 0 ? Math.max(...durs) : null;

    const result = await createComposite(user.id, memberIds, {
      activityId: body.activityId,
      durationMinutes,
    });
    if (!result.ok) {
      // activityId not owned (or a member not visible) — surface it. With a
      // constant activityId and detector-sourced (visible, owned) members,
      // this fails on the first component before any mutation, so there's
      // no partial-merge to unwind.
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    merged += 1;
    eventsMerged += memberIds.length;
  }

  return NextResponse.json({ ok: true, merged, events: eventsMerged });
}
