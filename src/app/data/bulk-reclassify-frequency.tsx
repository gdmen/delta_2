"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type FrequencyHint = "daily" | "weekly" | "occasional";

/**
 * Button + inline modal for bulk-reclassifying the `frequency_hint` on
 * many metric_types at once. Lives in the /data metrics catalog
 * toolbar, surfaced when the user has selected one or more rows.
 *
 * Motivating case: every `bodyspec_dexa:*` metric_type is auto-tagged
 * `frequency_hint = "daily"` by the resolver, which causes
 * `excludeTodayIfDaily` to filter today's reading from any chart of a
 * DEXA scan saved today. Selecting all 55 bodyspec metrics on /data
 * and flipping them to `"occasional"` in one shot is the fast fix.
 */
export function BulkReclassifyFrequency({
  selectedIds,
  clearSelection,
}: {
  selectedIds: number[];
  clearSelection: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<FrequencyHint>("occasional");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/metric-types/bulk-frequency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, frequencyHint: frequency }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `Save failed (${res.status})`);
        setBusy(false);
        return;
      }
      // Done. Close the modal, clear selection, refresh so the (eventual)
      // frequency column on the table picks up the new value.
      setOpen(false);
      setBusy(false);
      clearSelection();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={busy}
        className="px-3 py-1.5 border border-border text-[0.8125rem] font-medium rounded hover:bg-surface disabled:opacity-50"
      >
        Reclassify {selectedIds.length} selected…
      </button>
      {open && (
        // Lightweight inline modal — same pattern as merge-modal.tsx
        // (overlay + centered card, click-outside-to-close).
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-background border border-border rounded shadow-lg max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[1rem] font-semibold mb-2">
              Reclassify {selectedIds.length} metric
              {selectedIds.length === 1 ? "" : "s"}
            </h2>
            <p className="text-[0.8125rem] text-text-secondary mb-4">
              Pick a new cadence. The change applies to every selected metric_type.
            </p>
            <label className="flex items-baseline gap-2 text-[0.875rem] mb-4">
              <span className="text-text-secondary">Cadence:</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as FrequencyHint)}
                disabled={busy}
                className="px-2 py-1 border border-border rounded font-mono text-[0.8125rem] focus:outline-none focus:border-foreground bg-background disabled:opacity-50"
              >
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="occasional">occasional</option>
              </select>
            </label>
            <p className="text-[0.75rem] text-muted mb-5">
              <span className="font-mono">daily</span> /{" "}
              <span className="font-mono">weekly</span>: rolling aggregate
              (steps, sleep, activity minutes). Today&apos;s value is mid-flight,
              so charts hide it. <span className="font-mono">occasional</span>:
              point-in-time (DEXA scan, body weight). Today&apos;s reading is
              the complete reading, so charts show it as soon as it&apos;s
              saved.
            </p>
            {error && (
              <div className="mb-3 p-2 border border-accent-red/40 bg-accent-red/10 rounded text-[0.75rem] text-accent-red">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
              >
                {busy
                  ? "Saving…"
                  : `Save (${selectedIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
