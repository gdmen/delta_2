import { db } from "@/db";
import { events } from "@/db/schema";
import { and, isNotNull, ne } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";

/**
 * Build a `{ activity_id: [type, ...] }` catalog from the user's existing
 * events for the CompositeMergeModal type-field datalist. Includes
 * visible + composite rows so previously-curated composite types show
 * up as suggestions for the next merge. hidden_by_composite rows are
 * excluded — their types are stale and would clutter the list.
 *
 * Free-text; the modal's input doesn't restrict to these. The catalog
 * is small (one row per distinct (activity_id, type)), no need to paginate.
 */
export async function buildTypeSuggestionsByActivityId(
  userId: number,
): Promise<Record<number, string[]>> {
  const rows = await db
    .selectDistinct({ activityId: events.activityId, type: events.type })
    .from(events)
    .where(
      and(
        userScope(userId).events,
        ne(events.status, "hidden_by_composite"),
        isNotNull(events.type),
      ),
    );

  const out: Record<number, string[]> = {};
  for (const r of rows) {
    if (!r.type || !r.type.trim()) continue;
    (out[r.activityId] ??= []).push(r.type);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}
