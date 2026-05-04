import type { GoalProgress } from "@/lib/goal-format";
import type { GoalListConfig } from "./schema";

export function dataKey(config: GoalListConfig): string {
  return `goal_list:${config.sportFilter ?? "all"}`;
}

export interface GoalRow {
  id: number;
  metricName: string;
  metricUnit: string;
  targetValue: number;
  deadline: string;
  sportName: string;
  sportColor: string;
  progress: GoalProgress;
}
