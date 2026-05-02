import { defineWidget } from "../types";
import { metricStripSchema, type MetricStripConfig } from "./schema";
import { metricStripDataDeps } from "./data";
import { MetricStripComponent } from "./Component";

export const metricStripWidget = defineWidget<MetricStripConfig>({
  type: "metric_strip",
  name: "Metric strip",
  description: "Top-row tiles of headline numbers with deltas.",
  category: "metric",
  defaultSize: { w: 12, h: 1 },
  minSize: { w: 6, h: 1 },
  schema: metricStripSchema,
  dataDeps: metricStripDataDeps,
  Component: MetricStripComponent,
});
