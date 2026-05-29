import { defineWidget } from "../types";
import { focusListSchema, type FocusListConfig } from "./schema";
import { FocusListComponent } from "./Component";

// dataDeps lives in src/lib/widgets/server-registry.ts.

export const focusListWidget = defineWidget<FocusListConfig>({
  type: "focus_list",
  name: "Focuses list",
  description: "Active focuses for one or all goals.",
  category: "focus",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 4, h: 2 },
  schema: focusListSchema,
  defaultConfig: { activityFilter: null, sourceFilter: "manual" },
  uiMeta: {
    activityFilter: {
      label: "Filter by activity",
      component: "activity-picker",
      helpText: "Show only focuses on goals for one activity.",
    },
    sourceFilter: {
      label: "Show",
      component: "select",
      helpText: "Manual focuses are user-set; LLM focuses are coach suggestions.",
      options: [
        { value: "manual", label: "Manual focuses only" },
        { value: "llm", label: "LLM-suggested only" },
        { value: "all", label: "All focuses" },
      ],
    },
  },
  Component: FocusListComponent,
});
