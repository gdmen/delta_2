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
/**
 * Time window expressed as a [from, to] tuple of integer day offsets
 * from today, in the user's local timezone.
 *
 *   - 0 = today (00:00:00 today through 23:59:59 today, local)
 *   - -1 = yesterday
 *   - -7 = a week ago
 *
 * `from` must be ≤ `to`. Both bounds are inclusive.
 *
 * Examples:
 *   [-6, 0]  → last 7 calendar days including today
 *   [-7, -1] → last 7 calendar days ending yesterday (the "skip today"
 *              shape used by the Recovery dashboard so today's partial
 *              numbers don't muddy the headline)
 *   [-30, 0] → last 30 days
 *
 * Omit `windowDays` entirely to load the full history.
 *
 * Replaces the pre-2026-05-11 `windowDays: number` scalar shape, which
 * meant "last N days ending today" with no way to shift the end. A
 * one-shot migration (scripts/migrate-window-days-to-range.ts) rewrote
 * existing rows from `N` → `[-N + 1, 0]` so the rendered window stayed
 * the same.
 */
export const windowDaysRange = z
  .tuple([z.number().int(), z.number().int()])
  .refine(([from, to]) => from <= to, {
    message: "windowDays must be [from, to] with from <= to",
  });

export const metricBlockSchema = z.object({
  metric: z.string().default(""),
  title: z.string().optional(),
  /** Time window. See windowDaysRange. Omit for full history. */
  windowDays: windowDaysRange.optional(),
  /**
   * What to show in the headline. "latest" = last sample value (default,
   * matches PR1 behavior). "avg" = mean of all samples in the loaded
   * window — the right scoreboard number for compliance dashboards
   * ("how was sleep this week" rather than "what was last night").
   */
  headline: z.enum(["latest", "avg"]).default("latest"),
});

export type MetricBlockConfig = z.infer<typeof metricBlockSchema>;
