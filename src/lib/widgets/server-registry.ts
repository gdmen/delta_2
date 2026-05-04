import type { DataDep, ValidationResult, DrizzleDb } from "./types";
import { metricStripDataDeps } from "./metric-strip/data";
import { metricBlockDataDeps } from "./metric-block/data";
import { goalListDataDeps } from "./goal-list/data";
import { focusListDataDeps } from "./focus-list/data";
import { metricsGridDataDeps } from "./metrics-grid/data";
import { bigThreeDataDeps } from "./big-three/data";
import { goalBarDataDeps } from "./goal-bar/data";
import { sessionsListDataDeps } from "./sessions-list/data";
import { coachCardDataDeps } from "./coach-card/data";

/**
 * Server-only widget registry: per-widget-type dataDeps + validate hooks.
 * These can't live on the client `WidgetDef` because their data.ts files
 * import `db` (better-sqlite3 → fs), which Turbopack would otherwise drag
 * into the client bundle when the editor lazy-imports the registry.
 *
 * The renderer + mutation routes look up by widget type here for the
 * server-only behaviors; the client-safe registry (registry.ts) covers
 * everything renderable in the browser.
 *
 * text_card and divider are pure-presentation (no DB reads) so they have
 * no entries here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataDepsFn = (config: any) => DataDep[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ValidateFn = (config: any, ctx: { db: DrizzleDb }) => Promise<ValidationResult>;

export const DATA_DEPS: Record<string, DataDepsFn | undefined> = {
  metric_strip: metricStripDataDeps as DataDepsFn,
  metric_block: metricBlockDataDeps as DataDepsFn,
  goal_list: goalListDataDeps as DataDepsFn,
  focus_list: focusListDataDeps as DataDepsFn,
  metrics_grid: metricsGridDataDeps as DataDepsFn,
  big_three: bigThreeDataDeps as DataDepsFn,
  goal_bar: goalBarDataDeps as DataDepsFn,
  sessions_list: sessionsListDataDeps as DataDepsFn,
  coach_card: coachCardDataDeps as DataDepsFn,
};

export const VALIDATE: Record<string, ValidateFn | undefined> = {
  // PR1 widgets don't ship validate hooks. PR2/E4 wired the slot to
  // surface fallback states; widgets opt in here when the registry needs
  // to enforce stale-ref or cross-table consistency.
};

export function lookupDataDeps(type: string): DataDepsFn | null {
  return DATA_DEPS[type] ?? null;
}

export function lookupValidate(type: string): ValidateFn | null {
  return VALIDATE[type] ?? null;
}
