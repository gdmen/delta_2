import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importSources, workoutSets, events, metricTypes } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * GET /api/import-sources/[id]/distinct-exercises
 * Returns the distinct exercise names present in workout_sets that came
 * from this source (joined to events by source tag). Powers the edit
 * page's WeightUnitEditor checkbox list when there's no CSV in hand to
 * derive choices from. Reads the canonical name from metric_types via
 * the workout_sets FK.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const srcRows = await db
    .select()
    .from(importSources)
    .where(and(userScope(user.id).importSources, eq(importSources.id, id)))
    .limit(1);
  if (srcRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sourceTag = srcRows[0].name.toLowerCase().replace(/\s+/g, "_");

  const rows = await db
    .selectDistinct({ name: metricTypes.name })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(metricTypes, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    .where(
      and(
        userScope(user.id).events,
        userScope(user.id).metricTypes,
        eq(events.source, sourceTag),
      ),
    )
    .orderBy(sql`lower(${metricTypes.name})`);

  return NextResponse.json(rows.map((r) => r.name));
}
