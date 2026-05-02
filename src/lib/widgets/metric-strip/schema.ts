import { z } from "zod";

const metricCellSchema = z.object({
  label: z.string().min(1),
  metric: z.string().min(1),
  mode: z.enum(["latest", "avg7", "raw"]),
  format: z.enum(["raw", "int", "hours"]),
  /** If set, appended to the formatted value (e.g. "120" + "g" → "120g"). */
  unit: z.string().optional(),
  /** If set, overrides the auto delta label (mode-specific default otherwise). */
  delta: z.string().optional(),
});

export const metricStripSchema = z.object({
  metrics: z.array(metricCellSchema).min(1).max(8),
});

export type MetricStripConfig = z.infer<typeof metricStripSchema>;
export type MetricStripCell = z.infer<typeof metricCellSchema>;
