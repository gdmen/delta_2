import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDashboard, loadWidgets, type WidgetRow } from "@/lib/dashboards/load";
import { lookupWidget } from "@/lib/widgets/registry";
import { collectDataDeps, runDataDeps } from "@/lib/widgets/data-deps";
import type { DataDep } from "@/lib/widgets/types";
import { DashboardGrid } from "./DashboardGrid";
import { WidgetSlot } from "./WidgetSlot";
import { DashboardEmptyState } from "./DashboardEmptyState";

interface ParsedWidget {
  widget: WidgetRow;
  parsed: unknown;
  parseError: string | null;
  deps: DataDep[];
}

/**
 * View-mode dashboard renderer. Loads the dashboard + its widgets, parses
 * each widget's config exactly once, dedupes data deps, runs them in
 * parallel, and renders the grid.
 *
 * `slug` is the URL segment ('today', 'recovery', 'body-comp', or any
 * user-created slug). 404 if not found.
 *
 * `debug` is true in dev or when ?debug=1 is set; controls whether widget
 * error fallbacks expose Debug info <details> panels.
 */
export async function DashboardRenderer({
  slug,
  debug = process.env.NODE_ENV !== "production",
}: {
  slug: string;
  debug?: boolean;
}) {
  const dashboard = await loadDashboard(slug);
  if (!dashboard) notFound();

  const widgets = await loadWidgets(dashboard.id);
  const parsedWidgets: ParsedWidget[] = widgets.map((w) => parseWidget(w));

  const data = await runDataDeps(collectDataDeps(parsedWidgets.map((p) => p.deps)));

  const settingsHref = `/dashboards/${dashboard.slug}/settings`;

  return (
    <div>
      {dashboard.name !== "Today" ? (
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="text-2xl font-semibold">{dashboard.name}</h1>
          <Link
            href={settingsHref}
            className="text-[0.8125rem] text-muted hover:text-foreground"
          >
            Settings
          </Link>
        </div>
      ) : (
        // Today keeps the headerless look from the original /. Settings link
        // floats top-right of the strip via a small absolute-positioned link.
        <div className="flex justify-end mb-2">
          <Link
            href={settingsHref}
            className="text-[0.75rem] text-muted hover:text-foreground"
          >
            Settings
          </Link>
        </div>
      )}
      {widgets.length === 0 ? (
        <DashboardEmptyState settingsHref={settingsHref} />
      ) : (
        <DashboardGrid>
          {parsedWidgets.map(({ widget, parsed, parseError }) => (
            <WidgetSlot
              key={widget.id}
              widget={widget}
              parsed={parsed}
              parseError={parseError}
              data={data}
              debug={debug}
            />
          ))}
        </DashboardGrid>
      )}
    </div>
  );
}

function parseWidget(widget: WidgetRow): ParsedWidget {
  const def = lookupWidget(widget.widgetType);
  if (!def) {
    return { widget, parsed: null, parseError: null, deps: [] };
  }
  try {
    const parsed = def.schema.parse(JSON.parse(widget.config));
    return {
      widget,
      parsed,
      parseError: null,
      deps: def.dataDeps?.(parsed) ?? [],
    };
  } catch (err) {
    return {
      widget,
      parsed: null,
      parseError: err instanceof Error ? err.message : String(err),
      deps: [],
    };
  }
}
