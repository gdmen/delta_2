import { z } from "zod";
import { windowDaysRange } from "../metric-block/schema";

// Target + higherIsBetter + unit live on metric_types now (see metric-block schema).
const cellSchema = z.object({
  metric: z.string().default(""),
  title: z.string().optional(),
  /** Time window as [from, to] day offsets from today. See metric-block schema. */
  windowDays: windowDaysRange.optional(),
  /** Headline: latest sample (default) or window mean. See metric-block schema. */
  headline: z.enum(["latest", "avg"]).default("latest"),
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
