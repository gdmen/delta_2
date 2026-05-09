import { getAllHistory, getLastDays } from "@/lib/metric-history";
import type { DataDep } from "../types";
import type { MetricBlockConfig } from "./schema";
import { dataKey } from "./keys";

export function metricBlockDataDeps(config: MetricBlockConfig, userId: number): DataDep[] {
  // Empty metric = freshly-added widget, user hasn't picked yet. Skip
  // the dep so we don't run a no-op `WHERE name = ""` query.
  if (!config.metric) return [];
  return [
    {
      key: dataKey(config),
      fetch: () =>
        config.windowDays
          ? getLastDays(config.metric, config.windowDays, userId)
          : getAllHistory(config.metric, userId),
    },
  ];
}
