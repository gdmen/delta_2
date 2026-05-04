import { defineWidget } from "../types";
import { goalBarSchema, type GoalBarConfig } from "./schema";
import { GoalBarComponent } from "./Component";

export const goalBarWidget = defineWidget<GoalBarConfig>({
  type: "goal_bar",
  name: "Goal progress bar",
  description: "Single goal with progress and required rate.",
  category: "goal",
  defaultSize: { w: 6, h: 1 },
  minSize: { w: 4, h: 1 },
  schema: goalBarSchema,
  defaultConfig: { goalId: 0 },
  uiMeta: {
    goalId: {
      label: "Goal id",
      component: "number",
      helpText: "Numeric id of the goal to display. Find it in /goals' URL when you click in.",
    },
  },
  Component: GoalBarComponent,
});
