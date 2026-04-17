import { db } from "@/db";
import { metrics, events } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Per-source activity summary for the data-sources index.
 *
 * Reads the `source` column on `metrics` and `events` and aggregates counts
 * + the latest timestamp seen. Used to show "last import" on the index
 * without navigating into each integration's sub-page.
 */

export interface SourceActivity {
  source: string;
  metricRowCount: number;
  eventRowCount: number;
  lastImportAt: string | null; // ISO (or null if no rows)
}

export async function getSourceActivity(): Promise<Record<string, SourceActivity>> {
  const metricRows = await db
    .select({
      source: metrics.source,
      count: sql<number>`count(*)`,
      lastAt: sql<string>`max(${metrics.recordedAt})`,
    })
    .from(metrics)
    .groupBy(metrics.source);

  const eventRows = await db
    .select({
      source: events.source,
      count: sql<number>`count(*)`,
      lastAt: sql<string>`max(${events.startedAt})`,
    })
    .from(events)
    .groupBy(events.source);

  const out: Record<string, SourceActivity> = {};

  const add = (source: string, kind: "metric" | "event", count: number, lastAt: string | null) => {
    const key = source ?? "unknown";
    const existing = out[key] ?? {
      source: key,
      metricRowCount: 0,
      eventRowCount: 0,
      lastImportAt: null,
    };
    if (kind === "metric") existing.metricRowCount += count;
    else existing.eventRowCount += count;
    if (lastAt && (!existing.lastImportAt || lastAt > existing.lastImportAt)) {
      existing.lastImportAt = lastAt;
    }
    out[key] = existing;
  };

  for (const r of metricRows) add(r.source, "metric", Number(r.count), r.lastAt);
  for (const r of eventRows) add(r.source, "event", Number(r.count), r.lastAt);

  return out;
}
