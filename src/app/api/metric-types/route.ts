import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metricTypes } from "@/db/schema";
import { eq } from "drizzle-orm";

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

/**
 * POST /api/metric-types — manually create a primitive numeric metric_type.
 * Body: { name, unit?, sportId?, frequencyHint? } where frequencyHint is
 * "daily" | "weekly" | "occasional" (default "daily").
 *
 * Returns 201 with the new row, or 409 if the name already exists.
 *
 * Computed metrics (powerlifting_total = bench_1rm + squat_1rm + deadlift_1rm)
 * and categorical metrics (bjj_belt) are NOT supported here — see TODOS.md.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as {
    name?: unknown;
    unit?: unknown;
    sportId?: unknown;
    frequencyHint?: unknown;
  };

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.length > 120) {
    return NextResponse.json({ error: "name too long (max 120 chars)" }, { status: 400 });
  }
  // Reserve `:` for source-imported metric names (`apple_health:HKFoo`,
  // `body_spec:arms_fat_pct`, etc.). Manual creation must use unprefixed
  // canonicals so the user merge UI stays unambiguous about which rows
  // are auto-created vs. user-created.
  if (name.includes(":")) {
    return NextResponse.json(
      { error: "name cannot contain ':' — that's reserved for source-imported metrics like body_spec:arms_fat_pct" },
      { status: 400 },
    );
  }

  const unit = typeof b.unit === "string" ? b.unit.trim() : "";
  // Empty unit is valid (e.g. reps, count). Cap length to keep the column sane.
  if (unit.length > 40) {
    return NextResponse.json({ error: "unit too long (max 40 chars)" }, { status: 400 });
  }

  let sportId: number | null = null;
  if (b.sportId !== null && b.sportId !== undefined && b.sportId !== "") {
    const n = Number(b.sportId);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "sportId must be a positive integer or null" },
        { status: 400 },
      );
    }
    sportId = n;
  }

  const frequencyHint: "daily" | "weekly" | "occasional" =
    b.frequencyHint === "daily" ||
    b.frequencyHint === "weekly" ||
    b.frequencyHint === "occasional"
      ? b.frequencyHint
      : "daily";

  // Pre-check uniqueness for a clean 409 instead of a raw SQLITE_CONSTRAINT.
  const existing = await db
    .select({ id: metricTypes.id })
    .from(metricTypes)
    .where(eq(metricTypes.name, name))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: `metric "${name}" already exists` },
      { status: 409 },
    );
  }

  const inserted = await db
    .insert(metricTypes)
    .values({ name, unit, sportId, frequencyHint })
    .returning({
      id: metricTypes.id,
      name: metricTypes.name,
      unit: metricTypes.unit,
      sportId: metricTypes.sportId,
      frequencyHint: metricTypes.frequencyHint,
    });

  return NextResponse.json(inserted[0], { status: 201 });
}
