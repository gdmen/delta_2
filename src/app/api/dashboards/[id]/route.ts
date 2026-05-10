import { NextResponse } from "next/server";
import { db } from "@/db";
import { dashboards } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { updateDashboardInput } from "@/lib/dashboards/validation";
import { readJson } from "@/lib/dashboards/request";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface Ctx {
  params: Promise<{ id: string }>;
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const r = await readJson(req);
  if (!r.ok) return r.response;
  const parsed = updateDashboardInput.safeParse(r.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const existing = await db
    .select()
    .from(dashboards)
    .where(and(userScope(user.id).dashboards, eq(dashboards.id, id)))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Dashboard not found." }, { status: 404 });
  }
  const row = existing[0];

  // System dashboards can be renamed, re-iconed, repositioned, but their slug
  // stays put — slug change would orphan the seeded_id mapping that keeps
  // future seed migrations idempotent.
  if (row.isSystem && parsed.data.slug !== undefined && parsed.data.slug !== row.slug) {
    return NextResponse.json(
      { error: "System dashboards can be renamed but their URL slug is locked." },
      { status: 400 },
    );
  }

  try {
    const updated = await db
      .update(dashboards)
      .set({
        ...parsed.data,
        updatedAt: new Date().toISOString(),
      })
      .where(and(userScope(user.id).dashboards, eq(dashboards.id, id)))
      .returning();
    return NextResponse.json({ dashboard: updated[0] });
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: `Slug "${parsed.data.slug}" already exists. Pick another.` },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const existing = await db
    .select()
    .from(dashboards)
    .where(and(userScope(user.id).dashboards, eq(dashboards.id, id)))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Dashboard not found." }, { status: 404 });
  }
  if (existing[0].isSystem) {
    return NextResponse.json(
      { error: "System dashboards can't be deleted." },
      { status: 400 },
    );
  }

  await db
    .delete(dashboards)
    .where(and(userScope(user.id).dashboards, eq(dashboards.id, id)));
  return NextResponse.json({ ok: true });
}
