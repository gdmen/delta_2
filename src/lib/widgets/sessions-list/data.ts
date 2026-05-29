import { db } from "@/db";
import { events, activities } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";
import type { DataDep } from "../types";
import type { SessionsListConfig } from "./schema";
import { dataKey, type SessionRow } from "./keys";

export function sessionsListDataDeps(config: SessionsListConfig, userId: number): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () => fetchSessions(config, userId),
    },
  ];
}

async function fetchSessions(config: SessionsListConfig, userId: number): Promise<SessionRow[]> {
  const conditions: SQL[] = [userScope(userId).events];
  if (config.activityFilter) {
    conditions.push(eq(activities.name, config.activityFilter));
  }
  const where = and(...conditions);

  return db
    .select({
      id: events.id,
      type: events.type,
      startedAt: events.startedAt,
      durationMinutes: events.durationMinutes,
      activityName: activities.name,
      activityColor: activities.color,
      notes: events.notes,
    })
    .from(events)
    .innerJoin(activities, eq(events.activityId, activities.id))
    .where(where)
    .orderBy(desc(events.startedAt))
    .limit(config.limit);
}
