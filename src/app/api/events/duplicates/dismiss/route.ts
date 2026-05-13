import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, eventDuplicateDenylist } from "@/db/schema";
import { and, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface DismissBody {
  aId: number;
  bId: number;
}

/**
 * POST /api/events/duplicates/dismiss
 *
 * Insert one (event_a_id, event_b_id) pair into the denylist so the
 * detector never re-surfaces it. Body: `{ aId, bId }`.
 *
 * Both events must exist and be owned by the caller — otherwise a
 * malicious payload could spam denylist rows referencing foreign
 * event ids (low impact, but still scoped here for defense in depth).
 *
 * Idempotent: ON CONFLICT DO NOTHING. Re-dismissing a pair that's
 * already in the list is a no-op.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: DismissBody;
  try {
    body = (await request.json()) as DismissBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !Number.isInteger(body.aId) ||
    !Number.isInteger(body.bId) ||
    body.aId === body.bId
  ) {
    return NextResponse.json(
      { error: "aId, bId required; aId != bId" },
      { status: 400 },
    );
  }

  const owns = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        userScope(user.id).events,
        inArray(events.id, [body.aId, body.bId]),
      ),
    );
  if (owns.length !== 2) {
    return NextResponse.json(
      { error: "Both events must exist and be owned by the caller" },
      { status: 404 },
    );
  }

  const [eventAId, eventBId] =
    body.aId < body.bId ? [body.aId, body.bId] : [body.bId, body.aId];

  await db
    .insert(eventDuplicateDenylist)
    .values({ userId: user.id, eventAId, eventBId })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}
