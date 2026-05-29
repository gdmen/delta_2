import { z } from "zod";

export const sessionsListSchema = z.object({
  activityFilter: z.string().nullable().default(null),
  /** How many recent sessions to display. */
  limit: z.number().int().min(1).max(50).default(10),
});

export type SessionsListConfig = z.infer<typeof sessionsListSchema>;
