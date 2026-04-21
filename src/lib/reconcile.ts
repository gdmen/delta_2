import { db } from "@/db";
import {
  metrics,
  events,
  metricTypes,
  sourceSettings,
  reconcileLog,
} from "@/db/schema";
import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";

/**
 * Reconcile: after an ingest batch upserts its rows, delete other rows
 * of the same source inside the batch's covered date range that weren't
 * part of the batch. Opt-in per source via source_settings.reconcile_enabled.
 *
 * Scope rules:
 *   - Metrics are scoped per metric_type_id. A batch containing steps but
 *     no sleep leaves sleep history untouched.
 *   - Events are scoped globally for the source. A Strava batch covering
 *     [after, now] reconciles all events of source='strava' in that range.
 *
 * Workflow:
 *   1. Ingest handler creates a ReconcileTracker.
 *   2. As each metric/event upserts, it records the sourceId + timestamp.
 *   3. After the loop, the handler calls tracker.apply(source).
 *      - If reconcile is off, returns early.
 *      - Otherwise deletes + logs per-type / per-entity.
 */

export interface ReconcileSummary {
  enabled: boolean;
  metrics: {
    metricTypeId: number;
    metricName: string | null;
    deleted: number;
    rangeStart: string;
    rangeEnd: string;
  }[];
  events: { deleted: number; rangeStart: string; rangeEnd: string } | null;
}

interface MetricBucket {
  sourceIds: Set<string>;
  minAt: string;
  maxAt: string;
}
interface EventBucket {
  sourceIds: Set<string>;
  minAt: string;
  maxAt: string;
}

export class ReconcileTracker {
  private metricsByType = new Map<number, MetricBucket>();
  private eventBucket: EventBucket | null = null;

  recordMetric(metricTypeId: number, sourceId: string | null | undefined, recordedAt: string): void {
    if (!sourceId) return; // can't reconcile against rows with no source_id
    let bucket = this.metricsByType.get(metricTypeId);
    if (!bucket) {
      bucket = { sourceIds: new Set(), minAt: recordedAt, maxAt: recordedAt };
      this.metricsByType.set(metricTypeId, bucket);
    }
    bucket.sourceIds.add(sourceId);
    if (recordedAt < bucket.minAt) bucket.minAt = recordedAt;
    if (recordedAt > bucket.maxAt) bucket.maxAt = recordedAt;
  }

  recordEvent(sourceId: string | null | undefined, startedAt: string): void {
    if (!sourceId) return;
    if (!this.eventBucket) {
      this.eventBucket = { sourceIds: new Set(), minAt: startedAt, maxAt: startedAt };
    }
    this.eventBucket.sourceIds.add(sourceId);
    if (startedAt < this.eventBucket.minAt) this.eventBucket.minAt = startedAt;
    if (startedAt > this.eventBucket.maxAt) this.eventBucket.maxAt = startedAt;
  }

  /**
   * Force the event reconcile range to cover a specific window regardless
   * of what was actually upserted. Use this when the ingest call has a
   * known authoritative range even if the batch came back empty (Strava
   * syncs `[after, now]` — the most recently deleted activity wouldn't be
   * in the payload, so we need to reconcile past the upserted max).
   */
  setEventRange(start: string, end: string): void {
    if (!this.eventBucket) {
      this.eventBucket = { sourceIds: new Set(), minAt: start, maxAt: end };
      return;
    }
    if (start < this.eventBucket.minAt) this.eventBucket.minAt = start;
    if (end > this.eventBucket.maxAt) this.eventBucket.maxAt = end;
  }

  /**
   * Read source_settings; if reconcile is off, return enabled=false with
   * empty results. Otherwise run the per-type and per-event deletions and
   * write audit rows.
   */
  async apply(source: string): Promise<ReconcileSummary> {
    const settings = await db
      .select({ enabled: sourceSettings.reconcileEnabled })
      .from(sourceSettings)
      .where(eq(sourceSettings.source, source))
      .limit(1);

    const enabled = settings[0]?.enabled === true;
    if (!enabled) {
      return { enabled: false, metrics: [], events: null };
    }

    const summary: ReconcileSummary = { enabled: true, metrics: [], events: null };

    // --- Metrics -----------------------------------------------------------
    for (const [metricTypeId, bucket] of this.metricsByType.entries()) {
      const ids = [...bucket.sourceIds];
      const deleted = await db
        .delete(metrics)
        .where(
          and(
            eq(metrics.source, source),
            eq(metrics.metricTypeId, metricTypeId),
            gte(metrics.recordedAt, bucket.minAt),
            lte(metrics.recordedAt, bucket.maxAt),
            notInArray(metrics.sourceId, ids)
          )
        )
        .returning({ id: metrics.id });

      if (deleted.length > 0) {
        const typeRow = await db
          .select({ name: metricTypes.name })
          .from(metricTypes)
          .where(eq(metricTypes.id, metricTypeId))
          .limit(1);
        await db.insert(reconcileLog).values({
          source,
          kind: "metric",
          metricTypeId,
          deletedCount: deleted.length,
          rangeStart: bucket.minAt,
          rangeEnd: bucket.maxAt,
        });
        summary.metrics.push({
          metricTypeId,
          metricName: typeRow[0]?.name ?? null,
          deleted: deleted.length,
          rangeStart: bucket.minAt,
          rangeEnd: bucket.maxAt,
        });
      }
    }

    // --- Events ------------------------------------------------------------
    if (this.eventBucket) {
      const ids = [...this.eventBucket.sourceIds];
      const deleted = await db
        .delete(events)
        .where(
          and(
            eq(events.source, source),
            gte(events.startedAt, this.eventBucket.minAt),
            lte(events.startedAt, this.eventBucket.maxAt),
            notInArray(events.sourceId, ids)
          )
        )
        .returning({ id: events.id });

      if (deleted.length > 0) {
        await db.insert(reconcileLog).values({
          source,
          kind: "event",
          metricTypeId: null,
          deletedCount: deleted.length,
          rangeStart: this.eventBucket.minAt,
          rangeEnd: this.eventBucket.maxAt,
        });
        summary.events = {
          deleted: deleted.length,
          rangeStart: this.eventBucket.minAt,
          rangeEnd: this.eventBucket.maxAt,
        };
      }
    }

    return summary;
  }
}

// -----------------------------------------------------------------------------
// Query helpers for the UI
// -----------------------------------------------------------------------------

export interface LastReconcile {
  at: string;
  totalDeleted: number;
  perType: { metricName: string | null; kind: "metric" | "event"; deleted: number }[];
}

/**
 * Get the most recent reconcile activity for a source, grouped by batch.
 * A "batch" = all reconcile_log rows with the same `at` timestamp (the ingest
 * handler writes them back-to-back in a single call, so they share a second).
 */
export async function getLastReconcile(source: string): Promise<LastReconcile | null> {
  const rows = await db
    .select({
      id: reconcileLog.id,
      kind: reconcileLog.kind,
      metricTypeId: reconcileLog.metricTypeId,
      deletedCount: reconcileLog.deletedCount,
      at: reconcileLog.at,
      metricName: metricTypes.name,
    })
    .from(reconcileLog)
    .leftJoin(metricTypes, eq(reconcileLog.metricTypeId, metricTypes.id))
    .where(eq(reconcileLog.source, source))
    .orderBy(sql`${reconcileLog.at} desc`)
    .limit(50);

  if (rows.length === 0) return null;

  // Group by the most recent timestamp.
  const latestAt = rows[0].at;
  const batch = rows.filter((r) => r.at === latestAt);

  return {
    at: latestAt,
    totalDeleted: batch.reduce((s, r) => s + r.deletedCount, 0),
    perType: batch.map((r) => ({
      metricName: r.metricName ?? null,
      kind: r.kind,
      deleted: r.deletedCount,
    })),
  };
}
