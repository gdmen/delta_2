import { defineWidget } from "../types";
import { goalListSchema, type GoalListConfig } from "./schema";
import { goalListDataDeps } from "./data";
import { GoalListComponent } from "./Component";

export const goalListWidget = defineWidget<GoalListConfig>({
  type: "goal_list",
  name: "Goals list",
  description: "Active goals, optionally filtered by sport.",
  category: "goal",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 4, h: 2 },
  schema: goalListSchema,
  dataDeps: goalListDataDeps,
  Component: GoalListComponent,
});
