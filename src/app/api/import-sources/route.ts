import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importSources } from "@/db/schema";
import { asc } from "drizzle-orm";
import type { ImportMapping } from "@/lib/import-mapping";

/**
 * GET  /api/import-sources         list all saved sources
 * POST /api/import-sources         { name, kind, mapping } -> create
 */

export async function GET() {
  const rows = await db.select().from(importSources).orderBy(asc(importSources.name));
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      mapping: JSON.parse(r.mapping) as ImportMapping,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(request: NextRequest) {
  let body: { name?: string; kind?: string; mapping?: ImportMapping };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const KINDS = ["metrics", "events", "workout_sets"] as const;
  if (!body.kind || !KINDS.includes(body.kind as (typeof KINDS)[number])) {
    return NextResponse.json({ error: "kind must be metrics/events/workout_sets" }, { status: 400 });
  }
  if (!body.mapping || typeof body.mapping !== "object") {
    return NextResponse.json({ error: "mapping is required" }, { status: 400 });
  }

  try {
    const result = await db
      .insert(importSources)
      .values({
        name: body.name.trim(),
        kind: body.kind as (typeof KINDS)[number],
        mapping: JSON.stringify(body.mapping),
      })
      .returning({ id: importSources.id });

    return NextResponse.json({ id: result[0].id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json(
        { error: `An import source named "${body.name}" already exists` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
