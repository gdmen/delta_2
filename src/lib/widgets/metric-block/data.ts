import { getAllHistory, getLastDays, type Series } from "@/lib/metric-history";
import type { DataDep } from "../types";
import type { MetricBlockConfig } from "./schema";

export function metricBlockDataDeps(config: MetricBlockConfig): DataDep[] {
  return [
    {
      key: dataKey(config),
      fetch: () =>
        config.windowDays
          ? getLastDays(config.metric, config.windowDays)
          : getAllHistory(config.metric),
    },
  ];
}

export function dataKey(config: MetricBlockConfig): string {
  return `metric_block:${config.metric}:${config.windowDays ?? "all"}`;
}

export type { Series };
