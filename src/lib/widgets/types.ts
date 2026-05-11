import type { ZodType } from "zod";
import type { ComponentType, ReactNode } from "react";
import type { db } from "@/db";

/**
 * Result of a widget's `validate` hook. `ok: false` makes the slot render
 * a typed error state instead of the widget; `severity: 'warning'` still
 * renders but adds a banner. `canEdit: true` reveals an Edit button on
 * the error state that opens the settings drawer for this widget.
 */
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string; severity: "error" | "warning"; canEdit: boolean };

/**
 * One unit of server-side data the widget needs. The renderer collects all
 * deps across all widgets, dedupes by `key`, runs the fetchers in parallel
 * via Promise.allSettled, and passes the resulting Map down as `data`.
 *
 * `key` should be deterministic for the same logical query so two widgets
 * asking for the same data share the fetch (e.g. `metric:bench_1rm:30d`).
 */
export interface DataDep {
  key: string;
  fetch: () => Promise<unknown>;
}

/**
 * UI metadata co-located with each Zod field. Drives the auto-generated
 * settings form in PR3. PR1 widgets carry empty `uiMeta` since the editor
 * doesn't ship until PR3.
 */
export interface FieldMeta {
  label?: string;
  helpText?: string;
  component?: "text" | "number" | "select" | "metric-picker" | "sport-picker" | "boolean";
  options?: Array<{ value: string | number; label: string }>;
}

export type UIMeta<P> = Partial<Record<keyof P & string, FieldMeta>>;

/**
 * Drizzle handle threaded into validate(). Keeps validate() decoupled from
 * the import path of `@/db` (lets tests inject a mock).
 */
export type DrizzleDb = typeof db;

/**
 * One widget type. The registry is `Record<WidgetType, WidgetDef>`. Each
 * widget directory exports a default WidgetDef from its index.ts.
 *
 * `Component` receives the raw config (already parsed by `schema`) and a
 * Map of fetched data keyed by whatever `dataDeps` declared. PR1 widgets
 * are mostly RSC; chart-bearing widgets (metric_block) include
 * `'use client'` Recharts internals and accept the SSR boundary the way
 * existing MetricBlock already does.
 */
/**
 * Optional settings UI override. Auto-generated ZodForm handles flat-object
 * schemas; widgets with array or nested-object configs (e.g. metric_strip's
 * `{ metrics: array(...) }`) provide their own settings component.
 *
 * The override receives the current config and an `onChange` callback that
 * fires the parent SettingsDrawer's draft update — the drawer still owns
 * the autosave + live-preview wiring.
 */
export type CustomSettings<P> = ComponentType<{
  config: P;
  onChange: (next: P) => void;
  /**
   * Optional gate: custom settings call this with `false` when the user's
   * input is currently invalid (e.g. malformed JSON in metric_strip's
   * textarea). The SettingsDrawer disables Save until the next `true`.
   * Forms that always produce valid output can ignore this.
   */
  onValidityChange?: (valid: boolean) => void;
}>;

/**
 * Client-safe widget definition. Renderable in the browser without
 * pulling server-only modules (db, fs, etc) in.
 *
 * Server-only behaviors — `dataDeps` (which reads from db) and `validate`
 * (which can run db queries) — live in
 * `src/lib/widgets/server-registry.ts`. Renderer + mutation routes look
 * those up server-side; the editor's lazy-imported registry stays clean.
 */
export interface WidgetDef<P = unknown> {
  type: string;
  name: string;
  description: string;
  category: "metric" | "goal" | "focus" | "session" | "composite" | "text";
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  schema: ZodType<P>;
  /**
   * Initial config used when the user adds the widget from the palette.
   * Must satisfy `schema` (the POST route validates it). Required fields
   * that need user input (e.g. metric_block's `metric`) ship as empty
   * strings — the Component renders a "no data" / placeholder state, the
   * editor auto-opens the settings drawer so the user can fill them in.
   */
  defaultConfig: P;
  uiMeta?: UIMeta<P>;
  customSettings?: CustomSettings<P>;
  Component: ComponentType<{
    config: P;
    data: WidgetData;
    widgetId: number;
    /** True when rendering inside a /share/<token> page. Widgets that
     * link to internal app routes (e.g. metric-block → /data/metrics)
     * should suppress those affordances. Defaults to false. */
    shareMode?: boolean;
  }>;
}

/**
 * Sentinel stored in WidgetData when a fetcher rejected. Lets widget
 * Components and the renderer's debug surface distinguish "fetcher
 * threw" from "key not requested" (both look like `undefined` otherwise).
 */
export const DATA_DEP_ERROR = Symbol("DATA_DEP_ERROR");

export interface DataDepError {
  readonly kind: typeof DATA_DEP_ERROR;
  readonly message: string;
}

export function isDataDepError(v: unknown): v is DataDepError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { kind?: unknown }).kind === DATA_DEP_ERROR
  );
}

/**
 * Map of dep-key → resolved data. The value is whatever the fetcher
 * returned, OR a `DataDepError` sentinel if the fetcher rejected. A
 * missing key means no widget requested it. Widget Components should
 * treat both errored and missing as "no data" for display purposes;
 * the WidgetSlot debug surface reads the sentinel for diagnostics.
 */
export type WidgetData = Map<string, unknown>;

/**
 * Helper for typing widget definitions while keeping the Component prop
 * typed against the schema's inferred shape. Use as
 *   `defineWidget<MyConfig>({ ... })` from the widget's index.ts.
 */
export function defineWidget<P>(def: WidgetDef<P>): WidgetDef<P> {
  return def;
}

/**
 * Shared error fallback shape used by both the server try/catch and the
 * client error boundary. `widgetId` lets the client offer Edit/Delete
 * actions targeted at the right widget.
 */
export interface WidgetErrorInfo {
  widgetId: number;
  widgetType: string;
  config: unknown;
  reason: string;
  canEdit: boolean;
  debugInfo?: { error: string; stack?: string };
}

export type WidgetErrorRenderer = (info: WidgetErrorInfo) => ReactNode;
