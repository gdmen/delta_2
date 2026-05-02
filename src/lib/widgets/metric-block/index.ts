import { defineWidget } from "../types";
import { metricBlockSchema, type MetricBlockConfig } from "./schema";
import { metricBlockDataDeps } from "./data";
import { MetricBlockComponent } from "./Component";

export const metricBlockWidget = defineWidget<MetricBlockConfig>({
  type: "metric_block",
  name: "Metric chart",
  description: "One metric over time with optional target line.",
  category: "metric",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 3, h: 2 },
  schema: metricBlockSchema,
  dataDeps: metricBlockDataDeps,
  Component: MetricBlockComponent,
});
