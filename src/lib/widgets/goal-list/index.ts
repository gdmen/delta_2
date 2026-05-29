import { defineWidget } from "../types";
import { goalListSchema, type GoalListConfig } from "./schema";
import { GoalListComponent } from "./Component";

// dataDeps lives in src/lib/widgets/server-registry.ts.

export const goalListWidget = defineWidget<GoalListConfig>({
  type: "goal_list",
  name: "Goals list",
  description: "Active goals, optionally filtered by activity.",
  category: "goal",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 4, h: 2 },
  schema: goalListSchema,
  defaultConfig: { activityFilter: null },
  uiMeta: {
    activityFilter: {
      label: "Filter by activity",
      component: "activity-picker",
      helpText: "Show only goals for one activity. Leave blank for all goals.",
    },
  },
  Component: GoalListComponent,
});
