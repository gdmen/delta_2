import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventJournalEntries, events } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

// Hard cap so a runaway paste doesn't land a 10MB row. Matches the
// goal journal (src/app/api/goals/[id]/journal/route.ts).
const MAX_CONTENT_BYTES = 50_000;

/**
 * GET /api/events/:id/journal
 * Returns the event's journal entries, newest first. Owner-scoped via
 * the parent event (INHERIT). The page renders entries server-side, but
 * the unmerge dialog needs a LIVE count at click time — a stale
 * server-prop count would let the user unmerge a composite and silently
 * lose notes added in the same session. So this exists for that path.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const eventId = Number(idStr);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }

  const ownedEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(userScope(user.id).events);

  const rows = await db
    .select({
      id: eventJournalEntries.id,
      content: eventJournalEntries.content,
      createdAt: eventJournalEntries.createdAt,
      updatedAt: eventJournalEntries.updatedAt,
    })
    .from(eventJournalEntries)
    .where(
      and(
        eq(eventJournalEntries.eventId, eventId),
        inArray(eventJournalEntries.eventId, ownedEventIds),
      ),
    )
    .orderBy(desc(eventJournalEntries.createdAt));

  return NextResponse.json(rows);
}

/**
 * POST /api/events/:id/journal
 * Body: { content: string } → 201 with the new entry.
 *
 * event_journal_entries is INHERIT — owner-scoped through the parent
 * event. We confirm the event belongs to this user before inserting so
 * a cross-user write surfaces a clean 404, not an FK violation.
 *
 * No GET — the event detail page fetches entries server-side.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const eventId = Number(idStr);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }

  const ev = await db
    .select({ id: events.id })
    .from(events)
    .where(and(userScope(user.id).events, eq(events.id, eventId)))
    .limit(1);
  if (ev.length === 0) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as { content?: unknown };
  const content = typeof b.content === "string" ? b.content.trimEnd() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: `content too large (max ${MAX_CONTENT_BYTES} bytes)` },
      { status: 400 },
    );
  }

  const inserted = await db
    .insert(eventJournalEntries)
    .values({ eventId, content })
    .returning({
      id: eventJournalEntries.id,
      content: eventJournalEntries.content,
      createdAt: eventJournalEntries.createdAt,
      updatedAt: eventJournalEntries.updatedAt,
    });

  return NextResponse.json(inserted[0], { status: 201 });
}
