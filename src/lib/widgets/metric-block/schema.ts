import { z } from "zod";

/**
 * `metric` allows empty string so a fresh widget added from the palette
 * is schema-valid before the user picks one. The Component renders a
 * "no data yet" placeholder when metric is empty; the editor auto-opens
 * the settings drawer so users fill it in immediately.
 */
export const metricBlockSchema = z.object({
  metric: z.string().default(""),
  title: z.string().optional(),
  fallbackUnit: z.string().default(""),
  target: z.number().optional(),
  /** Time window in days. Omit for full history. */
  windowDays: z.number().int().positive().optional(),
});

export type MetricBlockConfig = z.infer<typeof metricBlockSchema>;
