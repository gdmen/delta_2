import type { SessionsListConfig } from "./schema";

export function dataKey(config: SessionsListConfig): string {
  return `sessions_list:${config.activityFilter ?? "all"}:${config.limit}`;
}

export interface SessionRow {
  id: number;
  type: string;
  startedAt: string;
  durationMinutes: number | null;
  activityName: string;
  activityColor: string;
  notes: string | null;
}
