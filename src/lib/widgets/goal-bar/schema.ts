import { z } from "zod";

export const goalBarSchema = z.object({
  /**
   * Goal id to render. Stored as a number; the validate hook flags stale
   * references (deleted goals) so the slot renders an error state with
   * an Edit CTA. 0 = unconfigured (palette default).
   */
  goalId: z.number().int().nonnegative().default(0),
});

export type GoalBarConfig = z.infer<typeof goalBarSchema>;
