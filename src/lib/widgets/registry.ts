import type { WidgetDef } from "./types";
import { metricStripWidget } from "./metric-strip";
import { metricBlockWidget } from "./metric-block";
import { goalListWidget } from "./goal-list";
import { focusListWidget } from "./focus-list";
import { metricsGridWidget } from "./metrics-grid";
import { bigThreeWidget } from "./big-three";
import { goalBarWidget } from "./goal-bar";
import { sessionsListWidget } from "./sessions-list";
import { coachCardWidget } from "./coach-card";
import { textCardWidget } from "./text-card";
import { dividerWidget } from "./divider";

/**
 * The widget registry. PR1 shipped 4 widgets; PR4 added 7 more
 * (metrics_grid, big_three, goal_bar, sessions_list, coach_card,
 * text_card, divider) for a total of 11.
 *
 * Adding a new widget = create src/lib/widgets/{kebab-case}/{schema,
 * Component,index}.ts (+ data.ts wired into server-registry.ts) and add
 * it here. The renderer + mutation routes pick it up automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGETS: Record<string, WidgetDef<any>> = {
  [metricStripWidget.type]: metricStripWidget,
  [metricBlockWidget.type]: metricBlockWidget,
  [goalListWidget.type]: goalListWidget,
  [focusListWidget.type]: focusListWidget,
  [metricsGridWidget.type]: metricsGridWidget,
  [bigThreeWidget.type]: bigThreeWidget,
  [goalBarWidget.type]: goalBarWidget,
  [sessionsListWidget.type]: sessionsListWidget,
  [coachCardWidget.type]: coachCardWidget,
  [textCardWidget.type]: textCardWidget,
  [dividerWidget.type]: dividerWidget,
};

export function lookupWidget(type: string): WidgetDef | null {
  return WIDGETS[type] ?? null;
}

export const WIDGET_TYPES = Object.keys(WIDGETS);
