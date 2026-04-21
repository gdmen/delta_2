import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export interface Series {
  samples: Array<{ date: string; value: number }>;
  unit: string;
}

/** Pull the full history of a metric, no time window. */
export async function getAllHistory(metricName: string): Promise<Series> {
  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt, unit: metricTypes.unit })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(eq(metricTypes.name, metricName))
    .orderBy(asc(metrics.recordedAt));

  return {
    samples: rows.map((r) => ({ date: r.recordedAt, value: r.value })),
    unit: rows[0]?.unit ?? "",
  };
}

/** Pull the last N days of a metric, ordered oldest-to-newest. */
export async function getLastDays(metricName: string, days: number): Promise<Series> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt, unit: metricTypes.unit })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(eq(metricTypes.name, metricName))
    .orderBy(asc(metrics.recordedAt));

  return {
    samples: rows
      .filter((r) => r.recordedAt >= sinceIso)
      .map((r) => ({ date: r.recordedAt, value: r.value })),
    unit: rows[0]?.unit ?? "",
  };
}
