import type { GoalProgress } from "@/lib/goal-format";
import type { GoalBarConfig } from "./schema";

export function dataKey(config: GoalBarConfig): string {
  return `goal_bar:${config.goalId}`;
}

export interface GoalBarData {
  id: number;
  metricName: string;
  metricUnit: string;
  targetValue: number;
  deadline: string;
  sportName: string;
  sportColor: string;
  progress: GoalProgress;
}
