import type { MetricBlockConfig } from "./schema";

/**
 * Stable cache key for the metric_block widget's data dep. Two
 * metric_block widgets pointing at the same metric + window share one
 * fetch via the dedupe layer.
 *
 * Lives in its own file (not data.ts) so the Component can import it
 * without pulling in `@/db` — keeps the client bundle clean.
 */
export function dataKey(config: MetricBlockConfig): string {
  return `metric_block:${config.metric}:${config.windowDays ?? "all"}`;
}

export interface Series {
  samples: Array<{ date: string; value: number }>;
  unit: string;
  target: number | null;
  higherIsBetter: boolean;
}
