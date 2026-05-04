import { defineWidget } from "../types";
import { dividerSchema, type DividerConfig } from "./schema";
import { DividerComponent } from "./Component";

export const dividerWidget = defineWidget<DividerConfig>({
  type: "divider",
  name: "Divider",
  description: "Section break with an optional heading.",
  category: "text",
  defaultSize: { w: 12, h: 1 },
  minSize: { w: 4, h: 1 },
  schema: dividerSchema,
  defaultConfig: { heading: "" },
  uiMeta: {
    heading: {
      label: "Heading",
      component: "text",
      helpText: "Optional. Leave blank for a plain hairline rule.",
    },
  },
  Component: DividerComponent,
});
