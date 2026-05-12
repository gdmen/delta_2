import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { goals, metricTypes, sports } from "@/db/schema";
import { and, eq, desc, ne } from "drizzle-orm";
import { computeGoalProgress } from "@/lib/goal-calc";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export async function GET() {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const rows = await db
    .select({
      id: goals.id,
      metricTypeId: goals.metricTypeId,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportId: goals.sportId,
      sportName: sports.name,
      sportColor: sports.color,
      name: goals.name,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      createdAt: goals.createdAt,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(and(userScope(user.id).goals, ne(goals.status, "abandoned")))
    .orderBy(desc(goals.createdAt));

  const enriched = await Promise.all(
    rows.map(async (g) => {
      const p = await computeGoalProgress(g, user.id);
      return {
        ...g,
        status: p.status,
        progressPct: p.progress,
        currentValue: p.currentValue,
      };
    })
  );

  return NextResponse.json(enriched);
}

interface CreateGoalBody {
  metricTypeId: number;
  sportId: number;
  targetValue: number;
  deadline: string; // YYYY-MM-DD
  name?: string | null;
}

const MAX_GOAL_NAME = 120;

export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: CreateGoalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.metricTypeId || !body.sportId || body.targetValue === undefined || !body.deadline) {
    return NextResponse.json(
      { error: "Missing required fields: metricTypeId, sportId, targetValue, deadline" },
      { status: 400 }
    );
  }

  // FK injection guard. Without these per-user checks, any caller
  // can attach a goal to ANY metric_type or sport id — the SELECT
  // JOIN on /goals would then leak the foreign owner's metric/sport
  // name + color into the caller's UI. The schema FKs alone don't
  // enforce per-user ownership; the queries do.
  const ownsMt = await db
    .select({ id: metricTypes.id })
    .from(metricTypes)
    .where(and(eq(metricTypes.id, body.metricTypeId), userScope(user.id).metricTypes))
    .limit(1);
  if (ownsMt.length === 0) {
    return NextResponse.json({ error: "metricTypeId not found" }, { status: 400 });
  }
  const ownsSport = await db
    .select({ id: sports.id })
    .from(sports)
    .where(and(eq(sports.id, body.sportId), userScope(user.id).sports))
    .limit(1);
  if (ownsSport.length === 0) {
    return NextResponse.json({ error: "sportId not found" }, { status: 400 });
  }

  // Optional name. Empty string and whitespace-only normalize to null so
  // the UI consistently falls back to the derived `<metric> <target><unit>`.
  let name: string | null = null;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (trimmed.length > MAX_GOAL_NAME) {
      return NextResponse.json(
        { error: `name must be ≤ ${MAX_GOAL_NAME} characters` },
        { status: 400 },
      );
    }
    name = trimmed.length > 0 ? trimmed : null;
  }

  const result = await db.insert(goals).values({
    userId: user.id,
    metricTypeId: body.metricTypeId,
    sportId: body.sportId,
    name,
    targetValue: body.targetValue,
    deadline: body.deadline,
  }).returning({ id: goals.id });

  return NextResponse.json({ id: result[0].id });
}
