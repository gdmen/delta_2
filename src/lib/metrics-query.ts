import { db } from "@/db";
import { metrics, metricTypes, events } from "@/db/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { userScope } from "./auth/scope";

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export async function getLatestMetric(metricName: string, userId: number): Promise<{ value: number; unit: string; recordedAt: string } | null> {
  const rows = await db
    .select({
      value: metrics.value,
      unit: metricTypes.unit,
      recordedAt: metrics.recordedAt,
    })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(
      and(
        userScope(userId).metrics,
        userScope(userId).metricTypes,
        eq(metricTypes.name, metricName),
      ),
    )
    .orderBy(desc(metrics.recordedAt))
    .limit(1);

  return rows[0] ?? null;
}

export async function getAverageLast7Days(metricName: string, userId: number): Promise<number | null> {
  const cutoff = daysAgoISO(7);
  const result = await db
    .select({ avg: sql<number | null>`AVG(${metrics.value})` })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(
      and(
        userScope(userId).metrics,
        userScope(userId).metricTypes,
        eq(metricTypes.name, metricName),
        gte(metrics.recordedAt, cutoff),
      ),
    );

  return result[0]?.avg ?? null;
}

export async function getSessionsThisWeek(userId: number): Promise<number> {
  const cutoff = daysAgoISO(7);
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(events)
    .where(and(userScope(userId).events, gte(events.startedAt, cutoff)));

  return result[0]?.count ?? 0;
}
