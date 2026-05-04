import { z } from "zod";

const cellSchema = z.object({
  metric: z.string().default(""),
  title: z.string().optional(),
  fallbackUnit: z.string().default(""),
  target: z.number().optional(),
  /** Time window in days. Omit for full history. */
  windowDays: z.number().int().positive().optional(),
});

/**
 * Multi-metric grid with a shared time axis. The shared x-range lets you
 * scan related series (e.g. weight + body fat + lean mass) and read the
 * timing of inflections at a glance — what Body Comp page used to do
 * before the dashboard editor existed.
 *
 * Caps at 12 metrics per grid; beyond that the grid stops being scannable
 * and the user wants two grids on a divided dashboard anyway.
 */
export const metricsGridSchema = z.object({
  title: z.string().default(""),
  columns: z.union([z.literal(1), z.literal(2)]).default(2),
  metrics: z.array(cellSchema).max(12).default([]),
});

export type MetricsGridConfig = z.infer<typeof metricsGridSchema>;
export type MetricsGridCell = z.infer<typeof cellSchema>;
