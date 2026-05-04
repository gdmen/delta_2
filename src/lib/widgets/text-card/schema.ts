import { z } from "zod";

/**
 * text_card stores its markdown body inside `config` for PR4. The 4KB
 * config cap (validation.ts CONFIG_MAX_BYTES) limits notes to ~3-4
 * thousand characters — enough for typical journal-style entries. A
 * future PR can migrate body out to the dedicated `dashboard_widgets.body`
 * TEXT column for unbounded length, with the schema flipping to read
 * from there instead.
 */
export const textCardSchema = z.object({
  body: z.string().default(""),
});

export type TextCardConfig = z.infer<typeof textCardSchema>;
