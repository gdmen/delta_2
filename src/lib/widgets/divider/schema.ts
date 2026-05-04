import { z } from "zod";

export const dividerSchema = z.object({
  heading: z.string().default(""),
});

export type DividerConfig = z.infer<typeof dividerSchema>;
