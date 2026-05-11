import { MetricBlock } from "@/components/metric-block";
import { isDataDepError, type WidgetData } from "../types";
import type { MetricBlockConfig } from "./schema";
import { dataKey, type Series } from "./keys";

export function MetricBlockComponent({
  config,
  data,
}: {
  config: MetricBlockConfig;
  data: WidgetData;
}) {
  if (!config.metric) {
    return (
      <div className="border border-border border-dashed rounded p-4 h-full flex items-center justify-center text-center text-[0.875rem] text-muted">
        No metric selected. Open the gear to pick one.
      </div>
    );
  }
  const raw = data.get(dataKey(config));
  const series: Series =
    isDataDepError(raw) || raw === undefined
      ? { samples: [], unit: "", target: null, higherIsBetter: true }
      : (raw as Series);
  return (
    <MetricBlock
      title={config.title ?? config.metric}
      metricName={config.metric}
      series={series}
      headline={config.headline}
    />
  );
}
