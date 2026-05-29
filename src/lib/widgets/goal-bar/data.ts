import { db } from "@/db";
import { goals, metricTypes, activities } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { computeGoalProgress } from "@/lib/goal-calc";
import { userScope } from "@/lib/auth/scope";
import type { DataDep } from "../types";
import type { GoalBarConfig } from "./schema";
import { dataKey, type GoalBarData } from "./keys";

export function goalBarDataDeps(config: GoalBarConfig, userId: number): DataDep[] {
  // 0 = unconfigured (palette default). Skip the fetch so the Component
  // renders the "pick a goal" placeholder.
  if (!config.goalId) return [];
  return [
    {
      key: dataKey(config),
      fetch: () => fetchGoal(config.goalId, userId),
    },
  ];
}

async function fetchGoal(goalId: number, userId: number): Promise<GoalBarData | null> {
  const rows = await db
    .select({
      id: goals.id,
      metricTypeId: goals.metricTypeId,
      name: goals.name,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      createdAt: goals.createdAt,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      activityName: activities.name,
      activityColor: activities.color,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(activities, eq(goals.activityId, activities.id))
    .where(and(userScope(userId).goals, eq(goals.id, goalId)))
    .limit(1);

  if (rows.length === 0) return null;
  const g = rows[0];
  return {
    id: g.id,
    name: g.name,
    metricName: g.metricName,
    metricUnit: g.metricUnit,
    targetValue: g.targetValue,
    deadline: g.deadline,
    activityName: g.activityName,
    activityColor: g.activityColor,
    progress: await computeGoalProgress(g, userId),
  };
}
