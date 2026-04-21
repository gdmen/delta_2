import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { eventMetrics } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string; metricTypeId: string }> }
) {
  const { eventId: eStr, metricTypeId: mStr } = await params;
  const eventId = parseInt(eStr, 10);
  const metricTypeId = parseInt(mStr, 10);
  if (isNaN(eventId) || isNaN(metricTypeId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await db
    .delete(eventMetrics)
    .where(and(eq(eventMetrics.eventId, eventId), eq(eventMetrics.metricTypeId, metricTypeId)));
  return NextResponse.json({ ok: true });
}
