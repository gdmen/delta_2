import type { SessionsListConfig } from "./schema";

export function dataKey(config: SessionsListConfig): string {
  return `sessions_list:${config.sportFilter ?? "all"}:${config.limit}`;
}

export interface SessionRow {
  id: number;
  type: string;
  startedAt: string;
  durationMinutes: number | null;
  sportName: string;
  sportColor: string;
  notes: string | null;
}
