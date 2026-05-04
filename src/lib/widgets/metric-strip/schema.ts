import { z } from "zod";

/**
 * Cell-level fields allow empty strings so a freshly-added strip is
 * schema-valid before the user fills cells in via the JSON editor.
 * Empty cells render as "no data" (label/metric blank) — they survive
 * a save round-trip and can be tweaked later.
 */
const metricCellSchema = z.object({
  label: z.string().default(""),
  metric: z.string().default(""),
  mode: z.enum(["latest", "avg7", "raw"]),
  format: z.enum(["raw", "int", "hours"]),
  /** If set, appended to the formatted value (e.g. "120" + "g" → "120g"). */
  unit: z.string().optional(),
  /** If set, overrides the auto delta label (mode-specific default otherwise). */
  delta: z.string().optional(),
});

/**
 * Strip allows 0-8 cells so a fresh strip from the palette saves cleanly.
 * The Component falls back to a "no cells" placeholder; users fill in
 * via the customSettings JSON editor.
 */
export const metricStripSchema = z.object({
  metrics: z.array(metricCellSchema).max(8).default([]),
});

export type MetricStripConfig = z.infer<typeof metricStripSchema>;
export type MetricStripCell = z.infer<typeof metricCellSchema>;
