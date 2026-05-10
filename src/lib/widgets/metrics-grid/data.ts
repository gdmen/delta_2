import { getAllHistory, getLastDays } from "@/lib/metric-history";
import type { DataDep } from "../types";
import type { MetricsGridConfig } from "./schema";
import { cellKey } from "./keys";

export function metricsGridDataDeps(config: MetricsGridConfig, userId: number): DataDep[] {
  return config.metrics
    .filter((c) => c.metric)
    .map((c) => ({
      key: cellKey(c),
      fetch: () =>
        c.windowDays
          ? getLastDays(c.metric, c.windowDays, userId)
          : getAllHistory(c.metric, userId),
    }));
}
