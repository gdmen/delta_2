import { NextResponse } from "next/server";
import { db } from "@/db";
import { dashboards } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { createDashboardInput } from "@/lib/dashboards/validation";
import { slugify } from "@/lib/dashboards/slug";
import { readJson } from "@/lib/dashboards/request";

export async function GET() {
  const rows = await db.select().from(dashboards).orderBy(asc(dashboards.position), asc(dashboards.id));
  return NextResponse.json({ dashboards: rows });
}

export async function POST(req: Request) {
  const r = await readJson(req);
  if (!r.ok) return r.response;
  const parsed = createDashboardInput.safeParse(r.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Auto-generate the slug from the name when the client didn't supply one.
  const slug = input.slug ?? slugify(input.name);
  if (!slug) {
    return NextResponse.json(
      { error: "Could not derive a slug from the name. Pick something with letters or digits." },
      { status: 400 },
    );
  }

  // Position defaults to "one past the current max" computed atomically via
  // SQL subquery so two simultaneous creates can't collide on the same value.
  // COALESCE handles the empty-table case by returning -1, so the first row
  // gets 0.
  const positionExpr = input.position !== undefined
    ? sql`${input.position}`
    : sql`(SELECT COALESCE(MAX(${dashboards.position}), -1) + 1 FROM ${dashboards})`;

  try {
    const inserted = await db
      .insert(dashboards)
      .values({
        slug,
        name: input.name,
        icon: input.icon,
        sportId: input.sportId ?? null,
        position: positionExpr as unknown as number,
        isSystem: false,
      })
      .returning();
    return NextResponse.json({ dashboard: inserted[0] }, { status: 201 });
  } catch (err) {
    // SQLite UNIQUE constraint failure on `dashboards.slug` shows up as a
    // SqliteError with `code: SQLITE_CONSTRAINT_UNIQUE`.
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: `Slug "${slug}" already exists. Pick another.` },
        { status: 409 },
      );
    }
    throw err;
  }
}
