import { defineWidget } from "../types";
import { coachCardSchema, type CoachCardConfig } from "./schema";
import { CoachCardComponent } from "./Component";

export const coachCardWidget = defineWidget<CoachCardConfig>({
  type: "coach_card",
  name: "Coach activity",
  description: "Most recent coach call (suggest, score, validate).",
  category: "composite",
  defaultSize: { w: 6, h: 1 },
  schema: coachCardSchema,
  defaultConfig: {},
  Component: CoachCardComponent,
});
