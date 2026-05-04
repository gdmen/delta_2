"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, BarChart3, Grid3x3, Target, ListChecks, Zap, Activity, Type, Minus, Search } from "lucide-react";
import { WIDGETS } from "@/lib/widgets/registry";
import { Drawer } from "./Drawer";

/**
 * Palette drawer: lists every registered widget grouped by category. Click
 * a row to add the widget. The palette closes after a successful add
 * (DashboardEditor handles that side via the `onPick` callback).
 *
 * Categories render in a fixed order matching the design doc's section
 * headings. Within a category, widgets are listed in their registry order
 * (which matches alphabetical-ish today; PR4 may add explicit ordering).
 */
const CATEGORY_ORDER = ["metric", "goal", "focus", "session", "composite", "text"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  metric: "Metrics",
  goal: "Goals",
  focus: "Focus",
  session: "Sessions",
  composite: "Composite",
  text: "Text",
};

/**
 * Mapping from widget type to a line icon. Picking by type (vs. category)
 * gives each widget its own glyph. Unknown types fall back to LayoutGrid.
 */
const WIDGET_ICON: Record<string, typeof LayoutGrid> = {
  metric_strip: BarChart3,
  metric_block: Activity,
  metrics_grid: Grid3x3,
  goal_bar: Target,
  goal_list: Target,
  focus_list: ListChecks,
  sessions_list: Zap,
  big_three: BarChart3,
  coach_card: Activity,
  text_card: Type,
  divider: Minus,
};

export function WidgetPalette({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (widgetType: string) => void;
}) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups: Record<string, Array<{ type: string; name: string; description: string }>> = {};
    for (const def of Object.values(WIDGETS)) {
      if (q && !`${def.name} ${def.description}`.toLowerCase().includes(q)) continue;
      if (!groups[def.category]) groups[def.category] = [];
      groups[def.category].push({ type: def.type, name: def.name, description: def.description });
    }
    return groups;
  }, [query]);

  return (
    <Drawer ariaLabel="Add widget" width="24rem" onClose={onClose}>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search widgets…"
          className="w-full pl-9 pr-3 py-2 border border-border rounded text-[0.8125rem] focus:outline-none focus:border-foreground"
        />
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        return (
          <div key={cat} className="mb-4">
            <div className="text-[0.75rem] uppercase tracking-wider text-muted px-1 mb-1 font-medium">
              {CATEGORY_LABEL[cat]}
            </div>
            {items.map((w) => {
              const Icon = WIDGET_ICON[w.type] ?? LayoutGrid;
              return (
                <button
                  key={w.type}
                  type="button"
                  onClick={() => onPick(w.type)}
                  className="w-full flex items-start gap-3 px-2 py-2 -mx-1 rounded hover:bg-surface text-left"
                >
                  <Icon size={16} className="text-text-tertiary mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[0.875rem] font-medium">{w.name}</div>
                    <div className="text-[0.75rem] text-muted">{w.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
      {Object.keys(grouped).length === 0 && (
        <p className="text-[0.8125rem] text-muted py-4 text-center">
          No widgets match &ldquo;{query}&rdquo;.
        </p>
      )}
    </Drawer>
  );
}
