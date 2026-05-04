import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export interface Series {
  samples: Array<{ date: string; value: number }>;
  unit: string;
  /** Target from metric_types (single source of truth). null if unset. */
  target: number | null;
  /** Target direction: true = floor, false = ceiling. Default true. */
  higherIsBetter: boolean;
}

/**
 * Lookup metric_type by name once (carries unit + target + direction). When
 * the name doesn't exist we still return a usable Series so the caller can
 * render an empty placeholder rather than crashing.
 */
async function loadType(metricName: string) {
  const rows = await db
    .select({
      id: metricTypes.id,
      unit: metricTypes.unit,
      target: metricTypes.target,
      higherIsBetter: metricTypes.higherIsBetter,
    })
    .from(metricTypes)
    .where(eq(metricTypes.name, metricName))
    .limit(1);
  return rows[0] ?? null;
}

/** Pull the full history of a metric, no time window. */
export async function getAllHistory(metricName: string): Promise<Series> {
  const type = await loadType(metricName);
  if (!type) return { samples: [], unit: "", target: null, higherIsBetter: true };

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id))
    .orderBy(asc(metrics.recordedAt));

  return {
    samples: rows.map((r) => ({ date: r.recordedAt, value: r.value })),
    unit: type.unit,
    target: type.target,
    higherIsBetter: type.higherIsBetter,
  };
}

/** Pull the last N days of a metric, ordered oldest-to-newest. */
export async function getLastDays(metricName: string, days: number): Promise<Series> {
  const type = await loadType(metricName);
  if (!type) return { samples: [], unit: "", target: null, higherIsBetter: true };

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id))
    .orderBy(asc(metrics.recordedAt));

  return {
    samples: rows
      .filter((r) => r.recordedAt >= sinceIso)
      .map((r) => ({ date: r.recordedAt, value: r.value })),
    unit: type.unit,
    target: type.target,
    higherIsBetter: type.higherIsBetter,
  };
}
