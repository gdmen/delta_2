import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { focuses, focusEntries } from "@/db/schema";
import { eq } from "drizzle-orm";

interface UpdateFocusBody {
  status?: "active" | "completed" | "abandoned";
  technicalNotes?: string;
  verdict?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: UpdateFocusBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof focuses.$inferInsert> = {};
  if (body.status) {
    updates.status = body.status;
    if (body.status === "completed" || body.status === "abandoned") {
      updates.endDate = new Date().toISOString().slice(0, 10);
    }
  }
  if (body.technicalNotes !== undefined) {
    updates.technicalNotes = body.technicalNotes;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(focuses).set(updates).where(eq(focuses.id, id));
  }

  // If a verdict was provided with a close, save it as a final focus entry.
  if (body.verdict && body.verdict.trim()) {
    await db.insert(focusEntries).values({
      focusId: id,
      content: `**Verdict:** ${body.verdict}`,
    });
  }

  return NextResponse.json({ ok: true });
}
