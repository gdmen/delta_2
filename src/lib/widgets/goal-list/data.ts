import { db } from "@/db";
import { goals, metricTypes, activities } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { computeGoalProgress } from "@/lib/goal-calc";
import { userScope } from "@/lib/auth/scope";
import type { DataDep } from "../types";
import type { GoalListConfig } from "./schema";
import { dataKey, type GoalRow } from "./keys";

export function goalListDataDeps(config: GoalListConfig, userId: number): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () => fetchGoals(config, userId),
    },
  ];
}


async function fetchGoals(config: GoalListConfig, userId: number): Promise<GoalRow[]> {
  const baseScope = and(userScope(userId).goals, ne(goals.status, "abandoned"));
  const where = config.activityFilter
    ? and(baseScope, eq(activities.name, config.activityFilter))
    : baseScope;

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
    .where(where);

  return Promise.all(
    rows.map(async (g) => ({
      id: g.id,
      name: g.name,
      metricName: g.metricName,
      metricUnit: g.metricUnit,
      targetValue: g.targetValue,
      deadline: g.deadline,
      activityName: g.activityName,
      activityColor: g.activityColor,
      progress: await computeGoalProgress(g, userId),
    })),
  );
}
