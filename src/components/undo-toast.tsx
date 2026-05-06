"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline undo toast. Listens for `delta:undo-toast` CustomEvents
 * (dispatched by the merge modals' useMergeSubmit hook on success) and
 * shows a Gmail-style "Undo" button for 8 seconds.
 *
 * Position: fixed bottom-left, 1rem from edges. Sidebar is on the left
 * so the toast is near the action source — matches Linear convention.
 *
 * Single-toast behavior: a new merge replaces an older toast; the
 * older merge stays undoable from /data/merges. Mounted once in the
 * root layout via <UndoToastHost />.
 */

export interface UndoToastDetail {
  mergeLogId: number;
  canonicalName: string;
  mergedCount: number;
  kind: "metric_type" | "sport";
}

const TOAST_EVENT = "delta:undo-toast";
const AUTO_DISMISS_MS = 8000;

export function dispatchUndoToast(detail: UndoToastDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

export function UndoToastHost() {
  const router = useRouter();
  const [toast, setToast] = useState<UndoToastDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
    setBusy(false);
    setError(null);
  }, []);

  // Subscribe to toast events. New toasts replace any in-flight one.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UndoToastDetail>).detail;
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast(detail);
      setBusy(false);
      setError(null);
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, AUTO_DISMISS_MS);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const undo = useCallback(async () => {
    if (!toast) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/merges/${toast.mergeLogId}/undo`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [toast, router, dismiss]);

  if (!toast) return null;

  const description =
    toast.mergedCount === 1
      ? `Merged 1 ${toast.kind.replace("_", " ")} into ${toast.canonicalName}.`
      : `Merged ${toast.mergedCount} ${toast.kind.replace("_", " ")}s into ${toast.canonicalName}.`;

  return (
    <div
      className="fixed bottom-4 left-4 z-50 max-w-[24rem] md:left-[calc(200px+1rem)] md:bottom-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={`rounded border bg-background shadow-lg px-4 py-3 flex items-center gap-3 text-[0.8125rem] ${
          error ? "border-accent-red/40" : "border-border"
        }`}
      >
        <span className="flex-1 truncate">
          {error ? <span className="text-accent-red">Undo failed: {error}</span> : description}
        </span>
        {!error && (
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            className="text-foreground underline underline-offset-2 hover:opacity-80 disabled:opacity-50 min-h-[1.5rem]"
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted hover:text-foreground -mr-1 px-1"
        >
          ×
        </button>
      </div>
    </div>
  );
}
