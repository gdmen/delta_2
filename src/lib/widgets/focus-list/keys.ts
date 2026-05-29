import type { FocusListConfig } from "./schema";

export function dataKey(config: FocusListConfig): string {
  return `focus_list:${config.activityFilter ?? "all"}:${config.sourceFilter}`;
}

export interface FocusRow {
  id: number;
  name: string;
  goalId: number;
  activityName: string;
  activityColor: string;
  startDate: string;
  /** Server-computed at fetch time so the Component stays pure. */
  weekNumber: number;
}
