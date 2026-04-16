import { NextResponse } from "next/server";
import { db } from "@/db";
import { metricTypes } from "@/db/schema";

export async function GET() {
  const rows = await db.select().from(metricTypes);
  return NextResponse.json(rows.map((m) => ({
    id: m.id,
    name: m.name,
    sportId: m.sportId,
    unit: m.unit,
    frequencyHint: m.frequencyHint,
  })));
}
