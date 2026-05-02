import { z } from "zod";

export const focusListSchema = z.object({
  sportFilter: z.string().nullable().default(null),
  sourceFilter: z.enum(["manual", "llm", "all"]).default("manual"),
});

export type FocusListConfig = z.infer<typeof focusListSchema>;
