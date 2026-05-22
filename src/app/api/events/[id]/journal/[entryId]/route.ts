import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventJournalEntries, events } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

const MAX_CONTENT_BYTES = 50_000;

// Canonical ISO timestamp for updated_at on edit. Matches the
// `$defaultFn(isoNow)` shape used across the schema.
const isoNow = () => new Date().toISOString();

/**
 * Resolve an entry id to a row the caller is allowed to touch: the
 * entry must exist, belong to the `[id]` event in the path, and that
 * event must be owned by the requesting user. Returns the entry id on
 * success, or null (caller turns that into a 404 — never confirm the
 * resource exists cross-user).
 *
 * event_journal_entries is INHERIT, so ownership is enforced by the
 * `inArray(eventId, <this user's event ids>)` subquery.
 */
async function resolveOwnedEntry(
  userId: number,
  eventId: number,
  entryId: number,
): Promise<number | null> {
  const ownedEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(userScope(userId).events);

  const rows = await db
    .select({ id: eventJournalEntries.id })
    .from(eventJournalEntries)
    .where(
      and(
        eq(eventJournalEntries.id, entryId),
        eq(eventJournalEntries.eventId, eventId),
        inArray(eventJournalEntries.eventId, ownedEventIds),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

function parseIds(idStr: string, entryStr: string) {
  const eventId = Number(idStr);
  const entryId = Number(entryStr);
  if (!Number.isFinite(eventId) || eventId <= 0) return null;
  if (!Number.isFinite(entryId) || entryId <= 0) return null;
  return { eventId, entryId };
}

/**
 * PATCH /api/events/:id/journal/:entryId
 * Body: { content } → edit. Sets updated_at to now.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr, entryId: entryStr } = await params;
  const ids = parseIds(idStr, entryStr);
  if (!ids) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
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

  const ownedId = await resolveOwnedEntry(user.id, ids.eventId, ids.entryId);
  if (ownedId === null) {
    return NextResponse.json({ error: "entry not found" }, { status: 404 });
  }

  const updated = await db
    .update(eventJournalEntries)
    .set({ content, updatedAt: isoNow() })
    .where(eq(eventJournalEntries.id, ownedId))
    .returning({
      id: eventJournalEntries.id,
      content: eventJournalEntries.content,
      createdAt: eventJournalEntries.createdAt,
      updatedAt: eventJournalEntries.updatedAt,
    });

  return NextResponse.json(updated[0]);
}

/**
 * DELETE /api/events/:id/journal/:entryId
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr, entryId: entryStr } = await params;
  const ids = parseIds(idStr, entryStr);
  if (!ids) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const ownedId = await resolveOwnedEntry(user.id, ids.eventId, ids.entryId);
  if (ownedId === null) {
    return NextResponse.json({ error: "entry not found" }, { status: 404 });
  }

  await db.delete(eventJournalEntries).where(eq(eventJournalEntries.id, ownedId));
  return NextResponse.json({ ok: true });
}
