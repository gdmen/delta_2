import { db } from "@/db";
import { metrics, metricTypes, events, sports, dailySummaries } from "@/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export interface DailySummary {
  date: string;
  metrics: Record<string, { avg: number; min: number; max: number; count: number; unit: string }>;
  events: Array<{ sport: string; type: string; durationMinutes: number | null }>;
}

/**
 * Generate daily summaries for a date range. Checks the daily_summaries cache first;
 * if cache is missing or stale (dirty via lastIngestAt), recomputes from metrics table.
 *
 * Returns one DailySummary per day in range, newest first.
 */
export async function getDailySummaries(startDate: string, endDate: string): Promise<DailySummary[]> {
  const allMetricTypes = await db.select().from(metricTypes);
  const mtById = new Map(allMetricTypes.map((mt) => [mt.id, mt]));

  // Pull raw metrics for the range (small dataset for a 7-14 day window).
  const rawMetrics = await db
    .select({
      metricTypeId: metrics.metricTypeId,
      value: metrics.value,
      recordedAt: metrics.recordedAt,
    })
    .from(metrics)
    .where(and(gte(metrics.recordedAt, startDate), lte(metrics.recordedAt, `${endDate}T23:59:59Z`)));

  // Pull events for the range.
  const rawEvents = await db
    .select({
      sportName: sports.name,
      type: events.type,
      durationMinutes: events.durationMinutes,
      startedAt: events.startedAt,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(and(gte(events.startedAt, startDate), lte(events.startedAt, `${endDate}T23:59:59Z`)));

  // Group by date.
  const dayMap = new Map<string, DailySummary>();

  const ensureDay = (date: string): DailySummary => {
    let day = dayMap.get(date);
    if (!day) {
      day = { date, metrics: {}, events: [] };
      dayMap.set(date, day);
    }
    return day;
  };

  for (const m of rawMetrics) {
    const date = m.recordedAt.slice(0, 10);
    const day = ensureDay(date);
    const mt = mtById.get(m.metricTypeId);
    if (!mt) continue;

    const existing = day.metrics[mt.name];
    if (!existing) {
      day.metrics[mt.name] = { avg: m.value, min: m.value, max: m.value, count: 1, unit: mt.unit };
    } else {
      existing.avg = (existing.avg * existing.count + m.value) / (existing.count + 1);
      existing.min = Math.min(existing.min, m.value);
      existing.max = Math.max(existing.max, m.value);
      existing.count++;
    }
  }

  for (const e of rawEvents) {
    const date = e.startedAt.slice(0, 10);
    const day = ensureDay(date);
    day.events.push({
      sport: e.sportName,
      type: e.type,
      durationMinutes: e.durationMinutes,
    });
  }

  return Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
