import { defineWidget } from "../types";
import { focusListSchema, type FocusListConfig } from "./schema";
import { focusListDataDeps } from "./data";
import { FocusListComponent } from "./Component";

export const focusListWidget = defineWidget<FocusListConfig>({
  type: "focus_list",
  name: "Focuses list",
  description: "Active focuses for one or all goals.",
  category: "focus",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 4, h: 2 },
  schema: focusListSchema,
  dataDeps: focusListDataDeps,
  Component: FocusListComponent,
});
