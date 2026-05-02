import type { WidgetDef } from "./types";
import { metricStripWidget } from "./metric-strip";
import { metricBlockWidget } from "./metric-block";
import { goalListWidget } from "./goal-list";
import { focusListWidget } from "./focus-list";

/**
 * The widget registry. PR1 ships 4 widgets; PR2 adds metrics_grid,
 * big_three, goal_bar, sessions_list, coach_card, text_card, divider for
 * a total of 11.
 *
 * Adding a new widget = create src/lib/widgets/{kebab-case}/{schema,data,
 * Component,index}.ts and add it here. The renderer + mutation routes pick
 * it up automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGETS: Record<string, WidgetDef<any>> = {
  [metricStripWidget.type]: metricStripWidget,
  [metricBlockWidget.type]: metricBlockWidget,
  [goalListWidget.type]: goalListWidget,
  [focusListWidget.type]: focusListWidget,
};

export function lookupWidget(type: string): WidgetDef | null {
  return WIDGETS[type] ?? null;
}

export const WIDGET_TYPES = Object.keys(WIDGETS);
