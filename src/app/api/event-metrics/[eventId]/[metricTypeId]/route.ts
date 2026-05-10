import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventMetrics, events } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string; metricTypeId: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { eventId: eStr, metricTypeId: mStr } = await params;
  const eventId = parseInt(eStr, 10);
  const metricTypeId = parseInt(mStr, 10);
  if (isNaN(eventId) || isNaN(metricTypeId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  // INHERIT scoping: scope the delete via this user's events.
  const ownedEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(userScope(user.id).events);
  await db
    .delete(eventMetrics)
    .where(
      and(
        eq(eventMetrics.eventId, eventId),
        eq(eventMetrics.metricTypeId, metricTypeId),
        inArray(eventMetrics.eventId, ownedEventIds),
      ),
    );
  return NextResponse.json({ ok: true });
}
