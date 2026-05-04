import { defineWidget } from "../types";
import { metricBlockSchema, type MetricBlockConfig } from "./schema";
import { MetricBlockComponent } from "./Component";

// dataDeps lives in src/lib/widgets/server-registry.ts.

export const metricBlockWidget = defineWidget<MetricBlockConfig>({
  type: "metric_block",
  name: "Metric chart",
  description: "One metric over time with optional target line.",
  category: "metric",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 3, h: 2 },
  schema: metricBlockSchema,
  defaultConfig: { metric: "", fallbackUnit: "" },
  uiMeta: {
    metric: {
      label: "Metric",
      component: "metric-picker",
      helpText: "Which metric to chart.",
    },
    title: {
      label: "Title",
      component: "text",
      helpText: "Header shown above the chart. Defaults to the metric name.",
    },
    fallbackUnit: {
      label: "Unit (fallback)",
      component: "text",
      helpText: "Shown when no readings exist yet (e.g. 'lb', 'g/cm²').",
    },
    target: {
      label: "Target value",
      component: "number",
      helpText: "Draws a horizontal target line. Leave blank for none.",
    },
    windowDays: {
      label: "Window (days)",
      component: "number",
      helpText: "Limit history to the last N days. Leave blank for all-time.",
    },
  },
  Component: MetricBlockComponent,
});
