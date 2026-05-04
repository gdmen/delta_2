import { defineWidget } from "../types";
import { metricStripSchema, type MetricStripConfig } from "./schema";
import { MetricStripComponent } from "./Component";
import { MetricStripSettings } from "./Settings";

// dataDeps lives in src/lib/widgets/server-registry.ts so client-side
// editor code (lazy-imported by DashboardRenderer) doesn't pull `db`
// → better-sqlite3 → fs into its bundle.
export const metricStripWidget = defineWidget<MetricStripConfig>({
  type: "metric_strip",
  name: "Metric strip",
  description: "Top-row tiles of headline numbers with deltas.",
  category: "metric",
  defaultSize: { w: 12, h: 1 },
  minSize: { w: 6, h: 1 },
  schema: metricStripSchema,
  defaultConfig: { metrics: [] },
  customSettings: MetricStripSettings,
  Component: MetricStripComponent,
});
