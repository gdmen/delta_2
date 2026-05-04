import type { MetricStripCell } from "./schema";

/**
 * Cache key per metric strip cell. Same metric + mode share one fetch
 * even across widgets. Lives in its own file (not data.ts) so the
 * Component can import it without pulling `@/db` into the client bundle.
 */
export function cellKey(cell: MetricStripCell): string {
  return `strip:${cell.metric}:${cell.mode}`;
}
