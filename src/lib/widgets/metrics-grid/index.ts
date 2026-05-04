import { defineWidget } from "../types";
import { metricsGridSchema, type MetricsGridConfig } from "./schema";
import { MetricsGridComponent } from "./Component";
import { MetricsGridSettings } from "./Settings";

export const metricsGridWidget = defineWidget<MetricsGridConfig>({
  type: "metrics_grid",
  name: "Metric grid",
  description: "Multiple metric charts sharing one time axis.",
  category: "metric",
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 6, h: 3 },
  schema: metricsGridSchema,
  defaultConfig: { title: "", columns: 2, metrics: [] },
  customSettings: MetricsGridSettings,
  Component: MetricsGridComponent,
});
