import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importSources, workoutSets, events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * GET /api/import-sources/[id]/distinct-exercises
 * Returns the distinct exercise_name values present in workout_sets that
 * came from this source (joined to events by source tag). Powers the
 * edit page's WeightUnitEditor checkbox list when there's no CSV in
 * hand to derive choices from.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const srcRows = await db.select().from(importSources).where(eq(importSources.id, id)).limit(1);
  if (srcRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sourceTag = srcRows[0].name.toLowerCase().replace(/\s+/g, "_");

  const rows = await db
    .selectDistinct({ name: workoutSets.exerciseName })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .where(eq(events.source, sourceTag))
    .orderBy(sql`lower(${workoutSets.exerciseName})`);

  return NextResponse.json(rows.map((r) => r.name));
}
