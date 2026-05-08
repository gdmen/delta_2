import type { BigThreeStats } from "@/lib/strength-metrics";
import type { BigThreeConfig } from "./schema";

/**
 * Stable cache key for the widget's data dep. Two big_three widgets
 * configured with the same three exercise names share a fetch via the
 * dedupe layer; widgets with different names each fetch their own.
 */
export function dataKey(config: BigThreeConfig): string {
  return `big_three:${config.squat}|${config.bench}|${config.deadlift}`;
}

export type BigThreeData = BigThreeStats;
