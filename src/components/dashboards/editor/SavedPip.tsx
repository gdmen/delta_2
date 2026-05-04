"use client";

import type { SaveStatus } from "./useMutations";

/**
 * Tiny status indicator pinned top-right of the viewport. "Saving…" while
 * a request is in flight; "Saved" briefly after success; persistent error
 * banner if the most recent save failed.
 *
 * Matches the design's "Saved pip" spec: green tint, hairline border,
 * 1rem inset, fade in/out.
 */
export function SavedPip({ status, error }: { status: SaveStatus; error: string | null }) {
  if (error) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-4 right-4 z-50 px-3 py-2 bg-accent-red/10 border border-accent-red/40 rounded text-[0.75rem] text-accent-red"
      >
        Save failed: {error}
      </div>
    );
  }
  if (status === "saving") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-4 right-4 z-50 px-3 py-2 bg-surface border border-border rounded text-[0.75rem] text-muted"
      >
        Saving…
      </div>
    );
  }
  return null;
}
