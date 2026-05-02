import { db } from "@/db";
import { focuses, goals, sports } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DataDep } from "../types";
import type { FocusListConfig } from "./schema";

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

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export function focusListDataDeps(config: FocusListConfig): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () => fetchFocuses(config),
    },
  ];
}

export function dataKey(config: FocusListConfig): string {
  return `focus_list:${config.sportFilter ?? "all"}:${config.sourceFilter}`;
}

async function fetchFocuses(config: FocusListConfig): Promise<FocusRow[]> {
  const conditions: SQL[] = [eq(focuses.status, "active"), isNull(focuses.dismissedAt)];
  if (config.sourceFilter !== "all") {
    conditions.push(eq(focuses.source, config.sourceFilter));
  }
  if (config.sportFilter) {
    conditions.push(eq(sports.name, config.sportFilter));
  }

  const rows = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      goalId: focuses.goalId,
      sportName: sports.name,
      sportColor: sports.color,
      startDate: focuses.startDate,
    })
    .from(focuses)
    .innerJoin(goals, eq(focuses.goalId, goals.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(and(...conditions));

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    weekNumber: Math.max(1, Math.ceil((now - new Date(r.startDate).getTime()) / MS_PER_WEEK)),
  }));
}
