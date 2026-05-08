import { z } from "zod";
// Import from the pure-constants module, NOT from `strength-metrics.ts`
// — that one pulls `import { db } from "@/db"` into the bundle, and
// the widget registry loads schema.ts in the editor's client component.
import { BIG_THREE_DEFAULT_NAMES } from "@/lib/strength-metrics-defaults";

/**
 * Per-slot exercise names. Each is an exact (case-insensitive) match
 * against `metric_types.name`; no substring fuzzing. Defaults to the
 * conventional barbell names but the user picks via the metric picker
 * in the widget settings drawer.
 */
export const bigThreeSchema = z.object({
  squat: z.string().default(BIG_THREE_DEFAULT_NAMES.squat),
  bench: z.string().default(BIG_THREE_DEFAULT_NAMES.bench),
  deadlift: z.string().default(BIG_THREE_DEFAULT_NAMES.deadlift),
});

export type BigThreeConfig = z.infer<typeof bigThreeSchema>;
