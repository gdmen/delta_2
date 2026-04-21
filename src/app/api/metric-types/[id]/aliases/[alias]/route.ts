import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metricTypeAliases } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * DELETE /api/metric-types/[id]/aliases/[alias]
 *
 * Removes a single alias → canonical mapping. Future ingests of this alias
 * will go back to falling through to `<source>:<rawName>` auto-create (or
 * land wherever another alias / source map routes them).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; alias: string }> }
) {
  const { id: idStr, alias: aliasEncoded } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const alias = decodeURIComponent(aliasEncoded);

  const deleted = await db
    .delete(metricTypeAliases)
    .where(
      and(
        eq(metricTypeAliases.canonicalMetricTypeId, id),
        eq(metricTypeAliases.alias, alias)
      )
    )
    .returning({ alias: metricTypeAliases.alias });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Alias not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: deleted[0].alias });
}
