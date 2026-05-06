"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Per-row Undo button on /data/merges. Calls POST /api/merges/:id/undo,
 * shows inline spinner during the request, swaps to red text + retry
 * on 409 chain-merge / conflict errors. Network failures show inline
 * error too.
 *
 * Successful undo refreshes the route — the row's `undone_at` is now
 * non-null on the next render, so the Undo button is replaced by the
 * "undone" affordance the parent renders for those rows.
 */
export function MergesUndoButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/merges/${id}/undo`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[18rem]">
        <span className="text-[0.6875rem] text-accent-red text-right">{error}</span>
        <button
          type="button"
          onClick={() => {
            setError(null);
            void handleClick();
          }}
          className="text-[0.75rem] text-foreground underline hover:opacity-80"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="text-[0.8125rem] text-foreground underline underline-offset-2 hover:opacity-80 disabled:opacity-50 min-h-[1.5rem]"
    >
      {busy ? "Undoing…" : "Undo"}
    </button>
  );
}
