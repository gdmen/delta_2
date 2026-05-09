import { db } from "@/db";
import { metrics, events } from "@/db/schema";
import { sql } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";

/**
 * Per-source activity summary for the data-sources index.
 *
 * Reads the `source` column on `metrics` and `events` and aggregates counts
 * + the latest timestamp seen. Used to show "last import" on the index
 * without navigating into each integration's sub-page.
 *
 * Per-user: only counts rows belonging to the requesting user — Alice's
 * data-sources page MUST NOT show Bob's row counts.
 */

export interface SourceActivity {
  source: string;
  metricRowCount: number;
  eventRowCount: number;
  firstDataAt: string | null; // earliest recordedAt/startedAt seen
  lastDataAt: string | null;  // latest recordedAt/startedAt seen
}

export async function getSourceActivity(userId: number): Promise<Record<string, SourceActivity>> {
  const metricRows = await db
    .select({
      source: metrics.source,
      count: sql<number>`count(*)`,
      firstAt: sql<string>`min(${metrics.recordedAt})`,
      lastAt: sql<string>`max(${metrics.recordedAt})`,
    })
    .from(metrics)
    .where(userScope(userId).metrics)
    .groupBy(metrics.source);

  const eventRows = await db
    .select({
      source: events.source,
      count: sql<number>`count(*)`,
      firstAt: sql<string>`min(${events.startedAt})`,
      lastAt: sql<string>`max(${events.startedAt})`,
    })
    .from(events)
    .where(userScope(userId).events)
    .groupBy(events.source);

  const out: Record<string, SourceActivity> = {};

  const add = (
    source: string,
    kind: "metric" | "event",
    count: number,
    firstAt: string | null,
    lastAt: string | null,
  ) => {
    const key = source ?? "unknown";
    const existing = out[key] ?? {
      source: key,
      metricRowCount: 0,
      eventRowCount: 0,
      firstDataAt: null,
      lastDataAt: null,
    };
    if (kind === "metric") existing.metricRowCount += count;
    else existing.eventRowCount += count;
    if (firstAt && (!existing.firstDataAt || firstAt < existing.firstDataAt)) {
      existing.firstDataAt = firstAt;
    }
    if (lastAt && (!existing.lastDataAt || lastAt > existing.lastDataAt)) {
      existing.lastDataAt = lastAt;
    }
    out[key] = existing;
  };

  for (const r of metricRows) add(r.source, "metric", Number(r.count), r.firstAt, r.lastAt);
  for (const r of eventRows) add(r.source, "event", Number(r.count), r.firstAt, r.lastAt);

  return out;
}
