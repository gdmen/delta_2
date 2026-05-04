import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { metricTypes, sports } from "@/db/schema";
import { asc } from "drizzle-orm";
import { loadDashboard, loadWidgets, type WidgetRow } from "@/lib/dashboards/load";
import { lookupWidget } from "@/lib/widgets/registry";
import { lookupDataDeps } from "@/lib/widgets/server-registry";
import { collectDataDeps, runDataDeps } from "@/lib/widgets/data-deps";
import type { DataDep } from "@/lib/widgets/types";
import { DashboardGrid } from "./DashboardGrid";
import { WidgetSlot } from "./WidgetSlot";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { EditorMount } from "./EditorMount";

interface ParsedWidget {
  widget: WidgetRow;
  parsed: unknown;
  parseError: string | null;
  deps: DataDep[];
}

/**
 * View-mode + edit-mode dashboard renderer. Loads the dashboard + its
 * widgets, parses each widget's config exactly once, dedupes data deps,
 * runs them in parallel, and renders the grid.
 *
 * In edit mode (`edit=true`), the same server-rendered widget bodies get
 * passed into a Client `<DashboardEditor>` which adds drag handles,
 * settings drawers, and the widget palette. The mutation API drives the
 * server changes; the renderer is replaced with `router.refresh()` after
 * each mutation to re-fetch fresh data.
 */
export async function DashboardRenderer({
  slug,
  edit = false,
  debug = process.env.NODE_ENV !== "production",
}: {
  slug: string;
  edit?: boolean;
  debug?: boolean;
}) {
  const dashboard = await loadDashboard(slug);
  if (!dashboard) notFound();

  const widgets = await loadWidgets(dashboard.id);
  const parsedWidgets: ParsedWidget[] = widgets.map((w) => parseWidget(w));

  const data = await runDataDeps(collectDataDeps(parsedWidgets.map((p) => p.deps)));

  const viewHref = dashboard.slug === "today" ? "/" : `/dashboards/${dashboard.slug}`;
  const editHref = `${viewHref}?edit=1`;
  const settingsHref = `/dashboards/${dashboard.slug}/settings`;

  // Each widget renders to a server-side ReactNode keyed by id. In edit
  // mode the EditableWidget wraps these as children; in view mode they
  // render directly inside WidgetSlot.
  const renderedById: Record<number, React.ReactNode> = {};
  for (const { widget, parsed, parseError } of parsedWidgets) {
    renderedById[widget.id] = (
      <WidgetSlot widget={widget} parsed={parsed} parseError={parseError} data={data} debug={debug} />
    );
  }

  if (edit) {
    // Picker context for widget settings forms. Loaded once per edit-page
    // render; keeps the SettingsDrawer drawer open instantly without a
    // separate fetch.
    const [metricRows, sportRows] = await Promise.all([
      db
        .select({ id: metricTypes.id, name: metricTypes.name, unit: metricTypes.unit })
        .from(metricTypes)
        .orderBy(asc(metricTypes.name)),
      db
        .select({ id: sports.id, name: sports.name, color: sports.color })
        .from(sports)
        .orderBy(asc(sports.name)),
    ]);
    return (
      <EditorMount
        dashboardId={dashboard.id}
        initialWidgets={widgets}
        renderedWidgets={renderedById}
        pickerContext={{ metricTypes: metricRows, sports: sportRows }}
        doneHref={viewHref}
      />
    );
  }

  return (
    <div>
      {dashboard.name !== "Today" ? (
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="text-2xl font-semibold">{dashboard.name}</h1>
          <div className="flex items-center gap-3">
            <Link href={editHref} className="text-[0.8125rem] text-muted hover:text-foreground">
              Edit
            </Link>
            <Link href={settingsHref} className="text-[0.8125rem] text-muted hover:text-foreground">
              Settings
            </Link>
          </div>
        </div>
      ) : (
        // Today keeps the headerless look. Edit + Settings float top-right.
        <div className="flex justify-end gap-3 mb-2">
          <Link href={editHref} className="text-[0.75rem] text-muted hover:text-foreground">
            Edit
          </Link>
          <Link href={settingsHref} className="text-[0.75rem] text-muted hover:text-foreground">
            Settings
          </Link>
        </div>
      )}
      {widgets.length === 0 ? (
        <DashboardEmptyState settingsHref={settingsHref} editHref={editHref} />
      ) : (
        <DashboardGrid>
          {parsedWidgets.map(({ widget }) => (
            <div
              key={widget.id}
              style={{
                gridColumn: `span ${widget.gridW}`,
                gridRow: `span ${widget.gridH}`,
                containerType: "inline-size",
              }}
            >
              {renderedById[widget.id]}
            </div>
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
    const dataDeps = lookupDataDeps(widget.widgetType);
    return {
      widget,
      parsed,
      parseError: null,
      deps: dataDeps?.(parsed) ?? [],
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
