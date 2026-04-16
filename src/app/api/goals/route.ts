import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { goals, metricTypes, sports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { computeGoalProgress } from "@/lib/goal-calc";

export async function GET() {
  const rows = await db
    .select({
      id: goals.id,
      metricTypeId: goals.metricTypeId,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportId: goals.sportId,
      sportName: sports.name,
      sportColor: sports.color,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      createdAt: goals.createdAt,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .orderBy(desc(goals.createdAt));

  const enriched = await Promise.all(
    rows.map(async (g) => {
      const p = await computeGoalProgress(g);
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
}

export async function POST(request: NextRequest) {
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

  const result = await db.insert(goals).values({
    metricTypeId: body.metricTypeId,
    sportId: body.sportId,
    targetValue: body.targetValue,
    deadline: body.deadline,
  }).returning({ id: goals.id });

  return NextResponse.json({ id: result[0].id });
}
