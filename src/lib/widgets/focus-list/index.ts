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
  defaultConfig: { sportFilter: null, sourceFilter: "manual" },
  uiMeta: {
    sportFilter: {
      label: "Filter by sport",
      component: "sport-picker",
      helpText: "Show only focuses on goals for one sport.",
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
