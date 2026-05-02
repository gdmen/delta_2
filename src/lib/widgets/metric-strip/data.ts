import { getLatestMetric, getAverageLast7Days, getSessionsThisWeek } from "@/lib/metrics-query";
import type { DataDep } from "../types";
import type { MetricStripConfig, MetricStripCell } from "./schema";

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
export function metricStripDataDeps(config: MetricStripConfig): DataDep[] {
  return config.metrics.map((cell) => ({
    key: cellKey(cell),
    fetch: () => fetchCell(cell),
  }));
}

export function cellKey(cell: MetricStripCell): string {
  return `strip:${cell.metric}:${cell.mode}`;
}

async function fetchCell(cell: MetricStripCell): Promise<unknown> {
  if (cell.mode === "latest") return getLatestMetric(cell.metric);
  if (cell.mode === "avg7") return getAverageLast7Days(cell.metric);
  if (cell.metric === "sessions_this_week") return getSessionsThisWeek();
  return null;
}
