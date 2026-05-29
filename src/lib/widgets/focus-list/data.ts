import { db } from "@/db";
import { focuses, goals, activities } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";
import type { DataDep } from "../types";
import type { FocusListConfig } from "./schema";
import { dataKey, type FocusRow } from "./keys";


const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export function focusListDataDeps(config: FocusListConfig, userId: number): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () => fetchFocuses(config, userId),
    },
  ];
}

async function fetchFocuses(config: FocusListConfig, userId: number): Promise<FocusRow[]> {
  // focuses is an INHERIT table — scope via the join through goals.user_id.
  const conditions: SQL[] = [
    userScope(userId).goals,
    eq(focuses.status, "active"),
    isNull(focuses.dismissedAt),
  ];
  if (config.sourceFilter !== "all") {
    conditions.push(eq(focuses.source, config.sourceFilter));
  }
  if (config.activityFilter) {
    conditions.push(eq(activities.name, config.activityFilter));
  }

  const rows = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      goalId: focuses.goalId,
      activityName: activities.name,
      activityColor: activities.color,
      startDate: focuses.startDate,
    })
    .from(focuses)
    .innerJoin(goals, eq(focuses.goalId, goals.id))
    .innerJoin(activities, eq(goals.activityId, activities.id))
    .where(and(...conditions));

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    weekNumber: Math.max(1, Math.ceil((now - new Date(r.startDate).getTime()) / MS_PER_WEEK)),
  }));
}
