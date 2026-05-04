import { db } from "@/db";
import { goals, metricTypes, sports } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { computeGoalProgress } from "@/lib/goal-calc";
import type { DataDep } from "../types";
import type { GoalListConfig } from "./schema";
import { dataKey, type GoalRow } from "./keys";

export function goalListDataDeps(config: GoalListConfig): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () => fetchGoals(config),
    },
  ];
}


async function fetchGoals(config: GoalListConfig): Promise<GoalRow[]> {
  const where = config.sportFilter
    ? and(ne(goals.status, "abandoned"), eq(sports.name, config.sportFilter))
    : ne(goals.status, "abandoned");

  const rows = await db
    .select({
      id: goals.id,
      metricTypeId: goals.metricTypeId,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      createdAt: goals.createdAt,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportName: sports.name,
      sportColor: sports.color,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(where);

  return Promise.all(
    rows.map(async (g) => ({
      id: g.id,
      metricName: g.metricName,
      metricUnit: g.metricUnit,
      targetValue: g.targetValue,
      deadline: g.deadline,
      sportName: g.sportName,
      sportColor: g.sportColor,
      progress: await computeGoalProgress(g),
    })),
  );
}
