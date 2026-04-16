import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { focuses, sports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      sportId: focuses.sportId,
      sportName: sports.name,
      sportColor: sports.color,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
      technicalNotes: focuses.technicalNotes,
    })
    .from(focuses)
    .innerJoin(sports, eq(focuses.sportId, sports.id))
    .orderBy(desc(focuses.createdAt));

  return NextResponse.json(rows);
}

interface CreateFocusBody {
  name: string;
  sportId: number;
  technicalNotes?: string;
}

export async function POST(request: NextRequest) {
  let body: CreateFocusBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || !body.sportId) {
    return NextResponse.json({ error: "Missing required fields: name, sportId" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await db.insert(focuses).values({
    name: body.name,
    sportId: body.sportId,
    startDate: today,
    status: "active",
    technicalNotes: body.technicalNotes,
  }).returning({ id: focuses.id });

  return NextResponse.json({ id: result[0].id });
}
