import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { focusEntries } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const focusId = parseInt(idStr, 10);
  if (isNaN(focusId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const rows = await db
    .select()
    .from(focusEntries)
    .where(eq(focusEntries.focusId, focusId))
    .orderBy(desc(focusEntries.createdAt));

  return NextResponse.json(rows);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const focusId = parseInt(idStr, 10);
  if (isNaN(focusId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json() as { content: string };
  if (!body.content) {
    return NextResponse.json({ error: "Missing content" }, { status: 400 });
  }

  const result = await db.insert(focusEntries).values({
    focusId,
    content: body.content,
  }).returning({ id: focusEntries.id });

  return NextResponse.json({ id: result[0].id });
}
