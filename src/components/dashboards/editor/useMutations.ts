"use client";

import { useCallback, useRef, useState } from "react";
import type { WidgetRow } from "@/lib/dashboards/row-types";

/**
 * Per-widget patch the editor sends to /api/dashboards/[id]/widgets/[wid].
 * `config` carries the parsed object (not JSON string) — the route
 * serializes + size-checks before insert. The other fields mirror their
 * WidgetRow types.
 */
export type WidgetPatch = Partial<
  Pick<WidgetRow, "body" | "gridX" | "gridY" | "gridW" | "gridH" | "position">
> & {
  config?: unknown;
};

interface QueueEntry {
  inFlight?: Promise<void>;
  pending?: WidgetPatch;
  pendingTimer?: ReturnType<typeof setTimeout>;
}

const AUTOSAVE_DEBOUNCE_MS = 500;

export type SaveStatus = "idle" | "saving" | "error";

/**
 * Editor mutation hook. Owns:
 *   - Per-widget queue (in-flight + pending) so out-of-order PATCHes can't
 *     happen during fast edits
 *   - Autosave debounce (500ms) on patchWidget — caller sends every keystroke,
 *     the queue coalesces them into one network round-trip
 *   - Layout/add/delete are immediate (no debounce) since they're one-shot
 *     events tied to user gestures
 *   - 401 detection: reload the page so the basic-auth re-prompt fires
 *
 * Status is exposed for the "Saved" pip toast in the editor toolbar.
 */
export function useMutations(dashboardId: number) {
  const queues = useRef<Map<number, QueueEntry>>(new Map());
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const showSavedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaved = useCallback(() => {
    setStatus("idle");
    if (showSavedRef.current) clearTimeout(showSavedRef.current);
    showSavedRef.current = setTimeout(() => setStatus("idle"), 800);
  }, []);

  /**
   * Centralized fetch with 401 = reload semantics. Any 401 from a mutation
   * means SITE_PASSWORD lapsed; the page reload triggers the basic-auth
   * re-prompt. Other errors set the lastError state for the toolbar to
   * surface.
   */
  const send = useCallback(
    async (input: string, init: RequestInit): Promise<Response | null> => {
      let res: Response;
      try {
        res = await fetch(input, init);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        return null;
      }
      if (res.status === 401) {
        window.location.reload();
        return null;
      }
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setLastError(json.error ?? `HTTP ${res.status}`);
        setStatus("error");
        return null;
      }
      setLastError(null);
      return res;
    },
    [],
  );

  /**
   * patchWidget(widgetId, patch) — debounced 500ms, per-widget queue.
   * Multiple keystroke-driven calls coalesce: the last patch wins per
   * tick, sent once after the debounce window. While a request is in
   * flight, the next patch waits in `pending` until completion.
   */
  const patchWidget = useCallback(
    (widgetId: number, patch: WidgetPatch) => {
      let entry = queues.current.get(widgetId);
      if (!entry) {
        entry = {};
        queues.current.set(widgetId, entry);
      }
      // Merge incoming patch into pending so later fields supersede earlier
      // ones for the same key, but earlier fields the client hasn't touched
      // again still get sent.
      entry.pending = { ...(entry.pending ?? {}), ...patch };
      setStatus("saving");

      // (Re-)arm the debounce timer.
      if (entry.pendingTimer) clearTimeout(entry.pendingTimer);
      entry.pendingTimer = setTimeout(() => flushOne(widgetId), AUTOSAVE_DEBOUNCE_MS);
    },
    // flushOne is defined below; recreating it is fine because the queue
    // state lives in a ref, not in the function closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Force-flush a widget's pending patch and wait for the queue to drain.
   * Returns a promise that resolves only when no patches are in flight or
   * pending for this widget — including any patches that arrived while a
   * previous one was being sent. Callers (Save button, settings-drawer
   * close, exit-edit-mode) can `await` this and know the server is caught
   * up before they `router.refresh()`.
   */
  const flushOne = useCallback(
    async (widgetId: number): Promise<void> => {
      const entry = queues.current.get(widgetId);
      if (!entry) return;
      // If a request is in flight, wait for it; the handler at the bottom
      // chains the next pending patch in via recursion. Re-entering here
      // after the in-flight settles picks up whatever queue state remains.
      if (entry.inFlight) {
        await entry.inFlight;
        return flushOne(widgetId);
      }
      if (!entry.pending) return;

      const next = entry.pending;
      entry.pending = undefined;
      if (entry.pendingTimer) clearTimeout(entry.pendingTimer);
      entry.pendingTimer = undefined;

      const promise = (async () => {
        await send(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
      })().finally(() => {
        entry.inFlight = undefined;
        if (!entry.pending) {
          const anyPending = [...queues.current.values()].some(
            (e) => e.pending || e.inFlight,
          );
          if (!anyPending) flashSaved();
        }
      });
      entry.inFlight = promise;
      await promise;
      // Drain anything that landed while we were sending.
      if (entry.pending) await flushOne(widgetId);
    },
    [dashboardId, send, flashSaved],
  );

  /**
   * Force-flush ALL pending widget patches and wait for them to drain.
   * Used by Done navigation so in-flight saves don't race the page nav.
   */
  const flushAll = useCallback(async (): Promise<void> => {
    const ids = [...queues.current.keys()];
    await Promise.all(ids.map((id) => flushOne(id)));
  }, [flushOne]);

  /**
   * One-shot mutations — no debounce, no queue. Add/delete/layout fire on
   * discrete user gestures (palette pick, drag-end, trash click), so
   * coalescing offers nothing.
   */
  const addWidget = useCallback(
    async (payload: {
      widgetType: string;
      config?: unknown;
      gridX?: number;
      gridY?: number;
      gridW?: number;
      gridH?: number;
    }): Promise<WidgetRow | null> => {
      setStatus("saving");
      const res = await send(`/api/dashboards/${dashboardId}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res) return null;
      const json = (await res.json()) as { widget: WidgetRow };
      flashSaved();
      return json.widget;
    },
    [dashboardId, send, flashSaved],
  );

  const deleteWidget = useCallback(
    async (widgetId: number): Promise<boolean> => {
      setStatus("saving");
      // Drop any pending edits for this widget — no point sending them after
      // the row is gone.
      const entry = queues.current.get(widgetId);
      if (entry?.pendingTimer) clearTimeout(entry.pendingTimer);
      queues.current.delete(widgetId);

      const res = await send(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: "DELETE",
      });
      if (!res) return false;
      flashSaved();
      return true;
    },
    [dashboardId, send, flashSaved],
  );

  /**
   * Batch reorder + resize. Position is sent per-widget alongside the
   * grid coords so a pure reorder (no size change) is still persisted —
   * the layout route's batch schema doesn't require position, but
   * omitting it from a reorder would no-op the most common drag flow.
   *
   * The route currently only updates grid_x/y/w/h; the position update
   * happens via per-widget patches at PR3. Future PRs can extend the
   * batch route to accept position too.
   */
  const patchLayout = useCallback(
    async (
      widgets: Array<{
        id: number;
        gridX: number;
        gridY: number;
        gridW: number;
        gridH: number;
        position: number;
      }>,
    ): Promise<boolean> => {
      if (widgets.length === 0) return true;
      setStatus("saving");
      // Layout route gets grid coords; per-widget position patches go via
      // patchWidget so the queue's debounce + dedupe still applies if the
      // user rapid-drags. Position is what changes most during drag.
      const res = await send(`/api/dashboards/${dashboardId}/layout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widgets: widgets.map((w) => ({
            id: w.id,
            gridX: w.gridX,
            gridY: w.gridY,
            gridW: w.gridW,
            gridH: w.gridH,
          })),
        }),
      });
      if (!res) return false;
      // Fire per-widget position patches in parallel. These coalesce
      // through the per-widget queue if multiple drags happen fast.
      for (const w of widgets) {
        patchWidget(w.id, { position: w.position });
      }
      flashSaved();
      return true;
    },
    [dashboardId, send, flashSaved, patchWidget],
  );

  return {
    status,
    lastError,
    patchWidget,
    flushOne,
    flushAll,
    addWidget,
    deleteWidget,
    patchLayout,
  };
}
