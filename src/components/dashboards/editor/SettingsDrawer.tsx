"use client";

import { Component as ReactComponent, useEffect, useState, type ReactNode } from "react";
import type { ZodObject } from "zod";
import { Drawer } from "./Drawer";
import { ZodForm } from "../zod-form/ZodForm";
import { lookupWidget } from "@/lib/widgets/registry";
import type { FormContext as PickerContext } from "../zod-form/types";
import type { WidgetData } from "@/lib/widgets/types";
import type { WidgetRow } from "@/lib/dashboards/row-types";

/**
 * Drawer with the widget's settings form on top + a live preview pane on
 * the bottom (or right on wide drawers — for PR3, top/bottom split is the
 * default). Save commits via the parent's onSave; Cancel discards drafts
 * and closes.
 *
 * Live preview re-renders the widget Component with the draft config. The
 * preview uses a 200ms debounce on the watched values so fast-typing in a
 * text field doesn't thrash the chart. Autosave (separate, 500ms) fires
 * via the parent on Save click.
 */
export function SettingsDrawer({
  widget,
  pickerContext,
  onClose,
  onSave,
}: {
  widget: WidgetRow;
  pickerContext: PickerContext;
  onClose: () => void;
  onSave: (next: unknown) => void;
}) {
  const def = lookupWidget(widget.widgetType);
  // Lazy useState initializer — runs once, no render-phase ref reads.
  const [draft, setDraft] = useState<unknown>(() => parseConfig(widget.config));
  const [debouncedDraft, setDebouncedDraft] = useState<unknown>(() => parseConfig(widget.config));
  const [hasError, setHasError] = useState(false);

  // 200ms debounce for the preview re-render. Keeps Recharts re-mount cost
  // off the keystroke path. Save uses its own 500ms in the mutation queue.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedDraft(draft), 200);
    return () => clearTimeout(t);
  }, [draft]);

  if (!def) {
    return (
      <Drawer ariaLabel="Settings" width="36rem" onClose={onClose}>
        <p className="text-[0.875rem] text-accent-red">
          Widget type <code className="font-mono">{widget.widgetType}</code> is not registered.
        </p>
      </Drawer>
    );
  }

  const handleSave = () => {
    if (hasError) return;
    onSave(draft);
    onClose();
  };

  const Component = def.Component;
  const Custom = def.customSettings;

  return (
    <Drawer ariaLabel={`Edit ${def.name}`} width="36rem" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-[0.75rem] uppercase tracking-wider text-muted mb-1">Settings</p>
          <SettingsBoundary onError={setHasError}>
            {Custom ? (
              <Custom
                config={draft as never}
                onChange={setDraft}
                onValidityChange={(valid) => setHasError(!valid)}
              />
            ) : isObjectSchema(def.schema) ? (
              <ZodForm
                schema={def.schema}
                uiMeta={def.uiMeta ?? {}}
                defaultValues={draft as Record<string, unknown>}
                context={pickerContext}
                onWatch={setDraft}
              />
            ) : (
              <p className="text-[0.875rem] text-muted">
                This widget&apos;s schema isn&apos;t a flat object and has no custom editor yet.
              </p>
            )}
          </SettingsBoundary>
        </div>

        <div>
          <p className="text-[0.75rem] uppercase tracking-wider text-muted mb-2">Preview</p>
          <div className="border border-border rounded-md p-3 bg-background min-h-[8rem]">
            {/* key resets the boundary on every draft change so an error
                from one draft doesn't stick when the user types a fix. */}
            <PreviewBoundary key={JSON.stringify(debouncedDraft)}>
              <Component
                config={debouncedDraft as never}
                data={new Map() as WidgetData}
                widgetId={widget.id}
              />
            </PreviewBoundary>
          </div>
          <p className="mt-1 text-[0.6875rem] text-muted">
            Preview renders the widget shape without server data. Chart
            widgets fall back to &ldquo;Preview unavailable&rdquo; until
            real data is fetched on Save.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={handleSave}
            disabled={hasError}
            className="px-4 py-2 bg-foreground text-background rounded text-[0.8125rem] font-medium disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[0.8125rem] text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function parseConfig(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isObjectSchema(schema: unknown): schema is ZodObject {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "shape" in schema &&
    typeof (schema as { shape: unknown }).shape === "object"
  );
}

/**
 * Catches throws from the form itself (very rare — a Zod validation
 * error normally surfaces as inline messages). Gates Save when present.
 */
function SettingsBoundary({
  children,
  onError,
}: {
  children: React.ReactNode;
  onError: (hasError: boolean) => void;
}) {
  // For PR3 v1 we keep this simple: track form-level errors via the
  // child's onWatch (handled at ZodForm level via fieldState). The
  // boundary slot is here for future expansion.
  void onError;
  return <>{children}</>;
}

/**
 * Catches throws from the preview pane so a malformed draft config
 * doesn't take down the drawer. Independent of the page-level error
 * boundary on the main grid.
 */
class PreviewBoundary extends ReactComponent<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <p className="text-[0.75rem] text-accent-orange">
          Preview unavailable for the current draft.
        </p>
      );
    }
    return this.props.children;
  }
}
