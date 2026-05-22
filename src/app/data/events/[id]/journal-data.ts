import { db } from "@/db";
import { eventJournalEntries, events } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";
import type { EventJournalEntry } from "./event-journal";

/**
 * Load an event's journal entries, newest first. INHERIT-scoped: the
 * `inArray(eventId, <this user's event ids>)` subquery enforces that
 * the caller only ever reads entries on events they own, even though
 * the entry table has no user_id. Shared by the regular event detail
 * page and the composite view. Issue #19.
 */
export async function loadEventJournal(
  eventId: number,
  userId: number,
): Promise<EventJournalEntry[]> {
  const ownedEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(userScope(userId).events);

  return db
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
}
