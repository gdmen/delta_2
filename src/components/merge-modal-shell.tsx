"use client";

import { ReactNode } from "react";

/**
 * Chrome + footer for the three merge modals (metric-types, activities,
 * exercises). Wraps an overlay + bordered panel with title/description,
 * Cancel/Merge footer buttons, and a standard error region. Per-kind
 * content (canonical picker, summary stats, unit rescale) renders as
 * children.
 */
export function MergeModalShell({
  title,
  description,
  busy,
  canSubmit,
  error,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  busy: boolean;
  canSubmit: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-[0.8125rem] text-text-secondary mt-1">{description}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {children}
          {error && (
            <div className="border border-red-500/40 bg-red-500/10 rounded p-3 text-[0.8125rem] text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSubmit || busy}
            className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
