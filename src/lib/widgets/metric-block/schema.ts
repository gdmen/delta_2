import { z } from "zod";

/**
 * `metric` allows empty string so a fresh widget added from the palette
 * is schema-valid before the user picks one. The Component renders a
 * "no data yet" placeholder when metric is empty; the editor auto-opens
 * the settings drawer so users fill it in immediately.
 */
/**
 * Target + higherIsBetter + unit all live on metric_types (single source of
 * truth) since 2026-05-04. Edit target/direction on the metric detail page;
 * unit comes through the SELECT. Old seed configs may still carry
 * `target` / `higherIsBetter` / `fallbackUnit` keys — Zod strips unknowns
 * on parse so they're harmless residue.
 */
export const metricBlockSchema = z.object({
  metric: z.string().default(""),
  title: z.string().optional(),
  /** Time window in days. Omit for full history. */
  windowDays: z.number().int().positive().optional(),
  /**
   * What to show in the headline. "latest" = last sample value (default,
   * matches PR1 behavior). "avg" = mean of all samples in the loaded
   * window — the right scoreboard number for compliance dashboards
   * ("how was sleep this week" rather than "what was last night").
   */
  headline: z.enum(["latest", "avg"]).default("latest"),
});

export type MetricBlockConfig = z.infer<typeof metricBlockSchema>;
