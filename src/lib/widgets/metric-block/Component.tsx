import { MetricBlock } from "@/components/metric-block";
import { isDataDepError, type WidgetData } from "../types";
import type { MetricBlockConfig } from "./schema";
import { dataKey, type Series } from "./data";

export function MetricBlockComponent({
  config,
  data,
}: {
  config: MetricBlockConfig;
  data: WidgetData;
}) {
  const raw = data.get(dataKey(config));
  const series: Series = isDataDepError(raw) || raw === undefined
    ? { samples: [], unit: config.fallbackUnit }
    : (raw as Series);
  return (
    <MetricBlock
      title={config.title ?? config.metric}
      series={series}
      fallbackUnit={config.fallbackUnit}
      target={config.target}
    />
  );
}
