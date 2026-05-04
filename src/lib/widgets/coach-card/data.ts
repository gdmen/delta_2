import { db } from "@/db";
import { coachCalls, goals, metricTypes } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { DataDep } from "../types";
import { DATA_KEY, type CoachCardData } from "./keys";

export function coachCardDataDeps(): DataDep[] {
  return [{ key: DATA_KEY, fetch: fetchLatest }];
}

/**
 * Most recent coach_call (success or failure). Joined with goal +
 * metric_type so the widget can show "suggest-focuses on Bench 315lb"
 * instead of bare ids. Returns null if there are no coach calls yet.
 */
async function fetchLatest(): Promise<CoachCardData | null> {
  const rows = await db
    .select({
      ts: coachCalls.ts,
      endpoint: coachCalls.endpoint,
      status: coachCalls.status,
      goalId: coachCalls.goalId,
      metricName: metricTypes.name,
      targetValue: goals.targetValue,
      metricUnit: metricTypes.unit,
    })
    .from(coachCalls)
    .leftJoin(goals, eq(coachCalls.goalId, goals.id))
    .leftJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .orderBy(desc(coachCalls.ts))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  const goalName =
    r.metricName && r.targetValue !== null && r.metricUnit !== null
      ? `${r.metricName} ${r.targetValue}${r.metricUnit}`
      : null;
  return {
    ts: r.ts,
    endpoint: r.endpoint,
    goalId: r.goalId,
    goalName,
    status: r.status,
  };
}
