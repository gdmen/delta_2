import { NextResponse } from "next/server";
import { db } from "@/db";
import { dashboards } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { createDashboardInput } from "@/lib/dashboards/validation";
import { slugify } from "@/lib/dashboards/slug";
import { readJson } from "@/lib/dashboards/request";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export async function GET() {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const rows = await db
    .select()
    .from(dashboards)
    .where(userScope(user.id).dashboards)
    .orderBy(asc(dashboards.position), asc(dashboards.id));
  return NextResponse.json({ dashboards: rows });
}

export async function POST(req: Request) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

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
  // gets 0. Restrict to this user so users don't share position pools.
  const positionExpr = input.position !== undefined
    ? sql`${input.position}`
    : sql`(SELECT COALESCE(MAX(${dashboards.position}), -1) + 1 FROM ${dashboards} WHERE ${dashboards.userId} = ${user.id})`;

  try {
    const inserted = await db
      .insert(dashboards)
      .values({
        userId: user.id,
        slug,
        name: input.name,
        icon: input.icon,
        activityId: input.activityId ?? null,
        position: positionExpr as unknown as number,
        isSystem: false,
      })
      .returning();
    return NextResponse.json({ dashboard: inserted[0] }, { status: 201 });
  } catch (err) {
    // Postgres unique violation = SQLSTATE 23505. postgres-js surfaces the
    // SQLSTATE on the driver-level PostgresError, but drizzle wraps that
    // inside its own "Failed query: ..." Error and exposes the original
    // via `.cause`. Walk both so we don't miss either shape.
    if (isPgCode(err, "23505")) {
      return NextResponse.json(
        { error: `Slug "${slug}" already exists. Pick another.` },
        { status: 409 },
      );
    }
    throw err;
  }
}

function isPgCode(err: unknown, code: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === "object" && (cur as { code?: string }).code === code) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
