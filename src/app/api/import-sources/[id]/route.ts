import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ImportMapping } from "@/lib/import-mapping";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const rows = await db.select().from(importSources).where(eq(importSources.id, id)).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = rows[0];
  return NextResponse.json({
    id: r.id,
    name: r.name,
    kind: r.kind,
    mapping: JSON.parse(r.mapping) as ImportMapping,
    createdAt: r.createdAt,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { name?: string; kind?: string; mapping?: ImportMapping };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof importSources.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.kind !== undefined) {
    if (!["metrics", "events", "workout_sets"].includes(body.kind)) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }
    updates.kind = body.kind as "metrics" | "events" | "workout_sets";
  }
  if (body.mapping !== undefined) updates.mapping = JSON.stringify(body.mapping);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db.update(importSources).set(updates).where(eq(importSources.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await db.delete(importSources).where(eq(importSources.id, id));
  return NextResponse.json({ ok: true });
}
