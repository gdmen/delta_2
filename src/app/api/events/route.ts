import { NextRequest, NextResponse } from "next/server";
import { upsertEvent } from "@/lib/ingest-service";
import { requireUserOr401 } from "@/lib/auth/require";

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
