import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { upsertEvent } from "@/lib/ingest-service";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface CreateEventBody {
  activityId: number;
  type: string;
  durationMinutes?: number;
  notes?: string;
  startedAt?: string;
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: CreateEventBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.activityId || !body.type) {
    return NextResponse.json({ error: "Missing required fields: activityId, type" }, { status: 400 });
  }

  // FK injection guard. The schema FK on events.activity_id only
  // enforces "some activity with this id exists" — it doesn't enforce
  // per-user ownership. Without this check the events row would
  // then JOIN activities on read and surface the foreign owner's activity
  // name + color into the caller's UI.
  const ownsActivity = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, body.activityId), userScope(user.id).activities))
    .limit(1);
  if (ownsActivity.length === 0) {
    return NextResponse.json({ error: "activityId not found" }, { status: 400 });
  }

  try {
    const result = await upsertEvent({
      userId: user.id,
      activityId: body.activityId,
      type: body.type,
      durationMinutes: body.durationMinutes ?? null,
      notes: body.notes ?? null,
      startedAt: body.startedAt ?? new Date().toISOString(),
      source: "manual",
      sourceId: null,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
