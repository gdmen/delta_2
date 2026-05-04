import { z } from "zod";

export const coachCardSchema = z.object({});

export type CoachCardConfig = z.infer<typeof coachCardSchema>;
