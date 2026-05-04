import { defineWidget } from "../types";
import { metricBlockSchema, type MetricBlockConfig } from "./schema";
import { MetricBlockComponent } from "./Component";

// dataDeps lives in src/lib/widgets/server-registry.ts.

export const metricBlockWidget = defineWidget<MetricBlockConfig>({
  type: "metric_block",
  name: "Metric chart",
  description: "One metric over time with optional target line.",
  category: "metric",
  defaultSize: { w: 6, h: 2 },
  minSize: { w: 3, h: 2 },
  schema: metricBlockSchema,
  defaultConfig: { metric: "", headline: "latest" },
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
    windowDays: {
      label: "Window (days)",
      component: "number",
      helpText: "Limit history to the last N days. Leave blank for all-time.",
    },
    headline: {
      label: "Headline",
      component: "select",
      options: [
        { value: "latest", label: "Latest reading" },
        { value: "avg", label: "Window average" },
      ],
      helpText: "Pair window average with a non-empty Window for compliance dashboards.",
    },
  },
  Component: MetricBlockComponent,
});
