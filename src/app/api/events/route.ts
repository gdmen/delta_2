import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sports } from "@/db/schema";
import { upsertEvent } from "@/lib/ingest-service";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface CreateEventBody {
  sportId: number;
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

  if (!body.sportId || !body.type) {
    return NextResponse.json({ error: "Missing required fields: sportId, type" }, { status: 400 });
  }

  // FK injection guard. The schema FK on events.sport_id only
  // enforces "some sport with this id exists" — it doesn't enforce
  // per-user ownership. Without this check the events row would
  // then JOIN sports on read and surface the foreign owner's sport
  // name + color into the caller's UI.
  const ownsSport = await db
    .select({ id: sports.id })
    .from(sports)
    .where(and(eq(sports.id, body.sportId), userScope(user.id).sports))
    .limit(1);
  if (ownsSport.length === 0) {
    return NextResponse.json({ error: "sportId not found" }, { status: 400 });
  }

  try {
    const result = await upsertEvent({
      userId: user.id,
      sportId: body.sportId,
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
