import { getLatestMetric, getAverageLast7Days, getSessionsThisWeek } from "@/lib/metrics-query";
import type { DataDep } from "../types";
import type { MetricStripConfig, MetricStripCell } from "./schema";
import { cellKey } from "./keys";

/**
 * Each cell becomes one DataDep keyed by `strip:<metric>:<mode>`. Two
 * metric_strips referencing the same metric in the same mode share one
 * fetch via the dedupe layer.
 *
 * Resolved value shape per key:
 *   latest: { value, unit, recordedAt } | null
 *   avg7:   number | null
 *   raw:    number   (only sessions_this_week today)
 */
export function metricStripDataDeps(config: MetricStripConfig, userId: number): DataDep[] {
  // Skip cells with no metric (palette-added cells before the user
  // configures them) so we don't run no-op WHERE name = "" queries.
  return config.metrics
    .filter((cell) => cell.metric.length > 0)
    .map((cell) => ({
      key: cellKey(cell),
      fetch: () => fetchCell(cell, userId),
    }));
}


async function fetchCell(cell: MetricStripCell, userId: number): Promise<unknown> {
  if (cell.mode === "latest") return getLatestMetric(cell.metric, userId);
  if (cell.mode === "avg7") return getAverageLast7Days(cell.metric, userId);
  if (cell.metric === "sessions_this_week") return getSessionsThisWeek(userId);
  return null;
}
