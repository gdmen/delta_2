import { defineWidget } from "../types";
import { bigThreeSchema, type BigThreeConfig } from "./schema";
import { BigThreeComponent } from "./Component";

export const bigThreeWidget = defineWidget<BigThreeConfig>({
  type: "big_three",
  name: "Big 3",
  description: "Squat / Bench / Deadlift current e1RM, top set, PR, trend.",
  category: "composite",
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 6, h: 3 },
  schema: bigThreeSchema,
  defaultConfig: {},
  Component: BigThreeComponent,
});
