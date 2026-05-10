import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importSources, metrics, metricTypes } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * GET /api/import-sources/[id]/existing-metric-types
 * Returns the distinct metric_types this source has actually written to,
 * with row counts. Used by the edit page to spot existing data that
 * doesn't match the new mapping's declared literal names - e.g. a source
 * whose old mapping was column-based ("Measurement") but new mapping is
 * literal "bodyweight", leaving "Bodyweight" behind as an orphan.
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
  if (srcRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sourceTag = srcRows[0].name.toLowerCase().replace(/\s+/g, "_");

  const rows = await db
    .select({
      id: metricTypes.id,
      name: metricTypes.name,
      count: sql<number>`count(${metrics.id})`,
    })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(
      and(
        userScope(user.id).metrics,
        userScope(user.id).metricTypes,
        eq(metrics.source, sourceTag),
      ),
    )
    .groupBy(metricTypes.id);

  return NextResponse.json(
    rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }))
  );
}
