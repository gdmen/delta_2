import { defineWidget } from "../types";
import { textCardSchema, type TextCardConfig } from "./schema";
import { TextCardComponent } from "./Component";
import { TextCardSettings } from "./Settings";

export const textCardWidget = defineWidget<TextCardConfig>({
  type: "text_card",
  name: "Notes",
  description: "Markdown notes you write yourself.",
  category: "text",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 4, h: 2 },
  schema: textCardSchema,
  defaultConfig: { body: "" },
  customSettings: TextCardSettings,
  Component: TextCardComponent,
});
