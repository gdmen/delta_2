import type { FocusListConfig } from "./schema";

export function dataKey(config: FocusListConfig): string {
  return `focus_list:${config.sportFilter ?? "all"}:${config.sourceFilter}`;
}

export interface FocusRow {
  id: number;
  name: string;
  goalId: number;
  sportName: string;
  sportColor: string;
  startDate: string;
  /** Server-computed at fetch time so the Component stays pure. */
  weekNumber: number;
}
