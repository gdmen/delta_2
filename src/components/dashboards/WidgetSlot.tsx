import { db } from "@/db";
import { lookupWidget } from "@/lib/widgets/registry";
import type { WidgetData, WidgetErrorInfo } from "@/lib/widgets/types";
import type { WidgetRow } from "@/lib/dashboards/load";
import { WidgetErrorFallback } from "./WidgetErrorFallback";
import { WidgetClientBoundary } from "./WidgetClientBoundary";

/**
 * Server-rendered cell that owns one widget's lifecycle:
 *  1. look up the def in the registry (unknown widget_type → fallback)
 *  2. parse config via the def's Zod schema (malformed config → fallback)
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
 * `container-type: inline-size` makes descendant container queries (chart
 * widgets) respond to the cell width rather than the viewport.
 *
 * `parsed` arrives pre-parsed from DashboardRenderer (which needs it to
 * collect dataDeps) so we don't double-parse. If parsing failed upstream
 * the renderer passes a `parseError`, which we render here.
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
  const style = {
    gridColumn: `span ${widget.gridW}`,
    gridRow: `span ${widget.gridH}`,
    containerType: "inline-size",
  } as const;

  const fallback = (info: WidgetErrorInfo) => (
    <div style={style}>
      <WidgetErrorFallback info={info} debug={debug} />
    </div>
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

  if (def.validate) {
    try {
      const result = await def.validate(parsed, { db });
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
    <div style={style}>
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
    </div>
  );
}
