import { db } from "@/db";
import { lookupWidget } from "@/lib/widgets/registry";
import { lookupValidate } from "@/lib/widgets/server-registry";
import type { WidgetData, WidgetErrorInfo } from "@/lib/widgets/types";
import type { WidgetRow } from "@/lib/dashboards/load";
import { WidgetErrorFallback } from "./WidgetErrorFallback";
import { WidgetClientBoundary } from "./WidgetClientBoundary";

/**
 * Server-rendered cell content for one widget. Owns:
 *  1. look up the def in the registry (unknown widget_type → fallback)
 *  2. handle upstream parseError (malformed config → fallback)
 *  3. run validate() if present (e.g. stale metric_type ref → fallback)
 *  4. render the def's Component, wrapped in a Client error boundary so
 *     render-time throws (Component body, descendant lifecycle, hydration)
 *     fall back to the typed error UI rather than crashing the whole route.
 *
 * The error story is split across two layers because RSC error boundaries
 * are Client-only:
 *  - server-side try/catch covers schema parse + validate (sync errors before
 *    React traversal),
 *  - WidgetClientBoundary covers Component render-time throws.
 *
 * Returns the inner content WITHOUT a grid-styled wrapper — the caller
 * (DashboardRenderer in view mode, EditableWidget in edit mode) supplies
 * the wrapper with grid-column/row spans and container-type. Splitting
 * the wrapper out lets the editor wrap the same body in its drag-handle
 * cell shape without double-wrapping.
 *
 * `parsed` arrives pre-parsed from DashboardRenderer (which needs it to
 * collect dataDeps) so we don't double-parse.
 */
export async function WidgetSlot({
  widget,
  parsed,
  parseError,
  data,
  debug,
}: {
  widget: WidgetRow;
  parsed: unknown;
  parseError: string | null;
  data: WidgetData;
  debug: boolean;
}) {
  const fallback = (info: WidgetErrorInfo) => (
    <WidgetErrorFallback info={info} debug={debug} />
  );

  const def = lookupWidget(widget.widgetType);
  if (!def) {
    return fallback({
      widgetId: widget.id,
      widgetType: widget.widgetType,
      config: widget.config,
      reason: `Unknown widget type "${widget.widgetType}".`,
      canEdit: false,
    });
  }

  if (parseError !== null) {
    return fallback({
      widgetId: widget.id,
      widgetType: widget.widgetType,
      config: widget.config,
      reason: "Widget configuration is invalid.",
      canEdit: true,
      debugInfo: { error: parseError },
    });
  }

  const validate = lookupValidate(widget.widgetType);
  if (validate) {
    try {
      const result = await validate(parsed, { db });
      if (!result.ok) {
        return fallback({
          widgetId: widget.id,
          widgetType: widget.widgetType,
          config: parsed,
          reason: result.reason,
          canEdit: result.canEdit,
        });
      }
    } catch (err) {
      return fallback({
        widgetId: widget.id,
        widgetType: widget.widgetType,
        config: parsed,
        reason: "Widget validation failed.",
        canEdit: true,
        debugInfo: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const Component = def.Component;
  return (
    <WidgetClientBoundary
      info={{
        widgetId: widget.id,
        widgetType: widget.widgetType,
        config: parsed,
      }}
      debug={debug}
    >
      <Component config={parsed} data={data} widgetId={widget.id} />
    </WidgetClientBoundary>
  );
}
