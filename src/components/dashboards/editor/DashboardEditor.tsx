"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import type { WidgetRow } from "@/lib/dashboards/row-types";
import type { FormContext as PickerContext } from "../zod-form/types";
import { EditableWidget } from "./EditableWidget";
import { useMutations } from "./useMutations";
import { WidgetPalette } from "./WidgetPalette";
import { SettingsDrawer } from "./SettingsDrawer";
import { SavedPip } from "./SavedPip";
import { DashboardGrid } from "../DashboardGrid";

const MAX_WIDGETS = 30;

interface Props {
  dashboardId: number;
  initialWidgets: WidgetRow[];
  /**
   * Server-rendered widget bodies, keyed by widget id. The editor uses
   * these as children of EditableWidget so chart widgets keep their RSC
   * + Recharts client-only path. When a widget's config changes, the
   * Save handler triggers router.refresh() to re-fetch the body.
   */
  renderedWidgets: Record<number, ReactNode>;
  pickerContext: PickerContext;
  /**
   * Where to navigate when the user clicks "Done". Today dashboard's
   * canonical view is `/`; other dashboards use `/dashboards/[slug]`.
   */
  doneHref: string;
}

/**
 * Edit-mode root. Owns the local layout state (so drag/resize don't ping
 * server on every tick), the mutation queue (per-widget debounced
 * autosave), and the palette + settings drawer state.
 */
export function DashboardEditor({
  dashboardId,
  initialWidgets,
  renderedWidgets,
  pickerContext,
  doneHref,
}: Props) {
  const router = useRouter();
  const mutations = useMutations(dashboardId);
  const [widgets, setWidgets] = useState<WidgetRow[]>(initialWidgets);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsForId, setSettingsForId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const settingsWidget = useMemo(
    () => widgets.find((w) => w.id === settingsForId) ?? null,
    [widgets, settingsForId],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      setWidgets((prev) => {
        const oldIdx = prev.findIndex((w) => w.id === active.id);
        const newIdx = prev.findIndex((w) => w.id === over.id);
        if (oldIdx < 0 || newIdx < 0) return prev;
        const next = arrayMove(prev, oldIdx, newIdx);
        const repositioned = next.map((w, i) => ({ ...w, position: i }));
        // Send position + grid coords for every widget whose index identity
        // shifted (the entire arrayMove range). The layout route updates
        // grid coords; per-widget queue persists the new position.
        const changed = repositioned
          .filter((w, i) => prev[i]?.id !== w.id)
          .map((w) => ({
            id: w.id,
            gridX: w.gridX,
            gridY: w.gridY,
            gridW: w.gridW,
            gridH: w.gridH,
            position: w.position,
          }));
        if (changed.length > 0) {
          void mutations.patchLayout(changed);
        }
        return repositioned;
      });
    },
    [mutations],
  );

  const onAddWidget = useCallback(
    async (widgetType: string) => {
      if (widgets.length >= MAX_WIDGETS) {
        setError(`Dashboards work best under ${MAX_WIDGETS} widgets. Consider splitting into two.`);
        return;
      }
      const created = await mutations.addWidget({ widgetType });
      if (!created) return;
      setPaletteOpen(false);
      // Pull the canonical row state (with server-applied position +
      // size defaults) and re-render the dashboard so the new widget
      // shows up with its server-fetched data.
      setWidgets((prev) => [...prev, created]);
      // Open the settings drawer immediately so the user fills in
      // required fields (e.g. metric_block needs a metric) on the same
      // gesture they used to add the widget.
      setSettingsForId(created.id);
      router.refresh();
    },
    [mutations, widgets.length, router],
  );

  const onDeleteWidget = useCallback(
    async (widgetId: number) => {
      const ok = await mutations.deleteWidget(widgetId);
      if (!ok) return;
      setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
      // If the deleted widget was open in settings, close the drawer.
      setSettingsForId((current) => (current === widgetId ? null : current));
      router.refresh();
    },
    [mutations, router],
  );

  // Stable id-keyed handlers for EditableWidget. Inline `() => fn(w.id)`
  // closures would defeat the cell's memo comparator on every parent
  // render (drag/resize emits one), causing chart widgets to re-render at
  // 60fps mid-drag.
  const handleSettingsById = useCallback((id: number) => setSettingsForId(id), []);
  const handleDeleteById = useCallback(
    (id: number) => {
      void onDeleteWidget(id);
    },
    [onDeleteWidget],
  );

  const onSaveSettings = useCallback(
    async (widgetId: number, nextConfig: unknown) => {
      mutations.patchWidget(widgetId, { config: nextConfig });
      // Optimistic local update so close-drawer-then-reopen shows the
      // new config without waiting for the server round-trip.
      setWidgets((prev) =>
        prev.map((w) => (w.id === widgetId ? { ...w, config: JSON.stringify(nextConfig) } : w)),
      );
      // Force-flush so the next router.refresh pulls the saved config
      // back, not pre-flush state.
      await mutations.flushOne(widgetId);
      router.refresh();
    },
    [mutations, router],
  );

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 gap-4">
        <div className="text-[0.8125rem] text-muted">
          Edit mode · {widgets.length} / {MAX_WIDGETS} widgets
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            disabled={widgets.length >= MAX_WIDGETS}
            className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-border rounded-md text-[0.8125rem] font-medium hover:border-foreground disabled:opacity-50"
          >
            <Plus size={14} /> Add widget
          </button>
          <a
            href={doneHref}
            className="px-3 py-1.5 bg-foreground text-background rounded-md text-[0.8125rem] font-medium"
          >
            Done
          </a>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {error}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <DashboardGrid>
            {widgets.map((w) => (
              <EditableWidget
                key={w.id}
                id={w.id}
                gridW={w.gridW}
                gridH={w.gridH}
                onSettingsById={handleSettingsById}
                onDeleteById={handleDeleteById}
              >
                {renderedWidgets[w.id]}
              </EditableWidget>
            ))}
          </DashboardGrid>
        </SortableContext>
      </DndContext>

      {paletteOpen && (
        <WidgetPalette
          onClose={() => setPaletteOpen(false)}
          onPick={(type) => void onAddWidget(type)}
        />
      )}

      {settingsWidget && (
        <SettingsDrawer
          widget={settingsWidget}
          pickerContext={pickerContext}
          onClose={() => setSettingsForId(null)}
          onSave={(next) => void onSaveSettings(settingsWidget.id, next)}
        />
      )}

      <SavedPip status={mutations.status} error={mutations.lastError} />
    </div>
  );
}
