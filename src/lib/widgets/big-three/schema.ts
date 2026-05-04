import { z } from "zod";

/**
 * Big-3 widget has no per-instance config — it's always squat/bench/dl
 * derived from workout_sets. Empty schema keeps the registry shape
 * consistent and lets the dashboard editor render an empty settings
 * drawer (or skip it).
 */
export const bigThreeSchema = z.object({});

export type BigThreeConfig = z.infer<typeof bigThreeSchema>;
