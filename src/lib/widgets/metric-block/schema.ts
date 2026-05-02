import { z } from "zod";

export const metricBlockSchema = z.object({
  metric: z.string().min(1),
  title: z.string().optional(),
  fallbackUnit: z.string().default(""),
  target: z.number().optional(),
  /** Time window in days. Omit for full history. */
  windowDays: z.number().int().positive().optional(),
});

export type MetricBlockConfig = z.infer<typeof metricBlockSchema>;
