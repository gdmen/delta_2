import { defineWidget } from "../types";
import { BIG_THREE_DEFAULT_NAMES } from "@/lib/strength-metrics";
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
  defaultConfig: { ...BIG_THREE_DEFAULT_NAMES },
  uiMeta: {
    squat: {
      label: "Squat exercise",
      component: "metric-picker",
      helpText: "Exact metric_type name to count toward the squat slot.",
    },
    bench: {
      label: "Bench exercise",
      component: "metric-picker",
      helpText: "Exact metric_type name to count toward the bench slot.",
    },
    deadlift: {
      label: "Deadlift exercise",
      component: "metric-picker",
      helpText: "Exact metric_type name to count toward the deadlift slot.",
    },
  },
  Component: BigThreeComponent,
});
