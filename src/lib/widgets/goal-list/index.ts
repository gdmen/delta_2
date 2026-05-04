import { defineWidget } from "../types";
import { goalListSchema, type GoalListConfig } from "./schema";
import { GoalListComponent } from "./Component";

// dataDeps lives in src/lib/widgets/server-registry.ts.

export const goalListWidget = defineWidget<GoalListConfig>({
  type: "goal_list",
  name: "Goals list",
  description: "Active goals, optionally filtered by sport.",
  category: "goal",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 4, h: 2 },
  schema: goalListSchema,
  defaultConfig: { sportFilter: null },
  uiMeta: {
    sportFilter: {
      label: "Filter by sport",
      component: "sport-picker",
      helpText: "Show only goals for one sport. Leave blank for all goals.",
    },
  },
  Component: GoalListComponent,
});
