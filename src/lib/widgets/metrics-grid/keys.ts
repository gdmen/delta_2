import type { MetricsGridCell } from "./schema";

/**
 * Cells share their cache key with metric_block so a metrics_grid + a
 * metric_block on the same page pointing at the same metric+window
 * dedupe to one fetch via the renderer's dep map.
 */
export function cellKey(cell: MetricsGridCell): string {
  return `metric_block:${cell.metric}:${cell.windowDays ?? "all"}`;
}
