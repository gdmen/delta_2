import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DataDep } from "../types";
import type { SessionsListConfig } from "./schema";
import { dataKey, type SessionRow } from "./keys";

export function sessionsListDataDeps(config: SessionsListConfig): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () => fetchSessions(config),
    },
  ];
}

async function fetchSessions(config: SessionsListConfig): Promise<SessionRow[]> {
  const conditions: SQL[] = [];
  if (config.sportFilter) {
    conditions.push(eq(sports.name, config.sportFilter));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      id: events.id,
      type: events.type,
      startedAt: events.startedAt,
      durationMinutes: events.durationMinutes,
      sportName: sports.name,
      sportColor: sports.color,
      notes: events.notes,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(where)
    .orderBy(desc(events.startedAt))
    .limit(config.limit);
}
