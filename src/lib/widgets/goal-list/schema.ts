import { z } from "zod";

export const goalListSchema = z.object({
  sportFilter: z.string().nullable().default(null),
});

export type GoalListConfig = z.infer<typeof goalListSchema>;
