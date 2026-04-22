"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pickMaxBy } from "@/lib/collections";

export interface ExerciseMergeCandidate {
  name: string;
  sets: number;
  eventCount: number;
}

interface Props {
  candidates: ExerciseMergeCandidate[];
  onClose: () => void;
}

/**
 * Merge modal for exercise names. Pick one of the selected names as
 * canonical; all workout_sets rows using the others get rewritten.
 * Exercises aren't a table, so there's nothing to delete — it's a pure
 * UPDATE against workout_sets.
 */
export function ExercisesMergeModal({ candidates, onClose }: Props) {
  const router = useRouter();
  const [canonical, setCanonical] = useState<string>(
    pickMaxBy(candidates, (c) => c.sets).name,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const merged = candidates.filter((c) => c.name !== canonical);
  const totalSetsMoved = merged.reduce((sum, m) => sum + m.sets, 0);
  const totalEventsAffected = merged.reduce((sum, m) => sum + m.eventCount, 0);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/exercises/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical,
          mergeNames: merged.map((m) => m.name),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

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
          <h2 className="text-lg font-semibold">Merge {candidates.length} exercises</h2>
          <p className="text-[0.8125rem] text-text-secondary mt-1">
            Pick the canonical name. Sets recorded under the other names are
            rewritten to use it.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[0.6875rem] font-mono uppercase tracking-wider text-muted mb-2">
              Canonical
            </div>
            <div className="space-y-1.5">
              {candidates.map((c) => (
                <label
                  key={c.name}
                  className="flex items-center gap-3 px-3 py-2 border border-border rounded cursor-pointer hover:bg-surface"
                >
                  <input
                    type="radio"
                    name="canonical"
                    checked={canonical === c.name}
                    onChange={() => setCanonical(c.name)}
                  />
                  <div className="flex-1 flex items-baseline justify-between gap-2 min-w-0">
                    <span className="font-mono text-[0.875rem] truncate">{c.name}</span>
                    <span className="font-mono text-[0.6875rem] text-muted shrink-0">
                      {c.sets.toLocaleString()} set{c.sets === 1 ? "" : "s"} ·{" "}
                      {c.eventCount.toLocaleString()} event
                      {c.eventCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="border border-border rounded p-3 text-[0.8125rem] space-y-1">
            <div className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-1">
              Summary
            </div>
            <div>
              <span className="font-mono">{totalSetsMoved.toLocaleString()}</span>{" "}
              set{totalSetsMoved === 1 ? "" : "s"} renamed to{" "}
              <code className="font-mono">{canonical}</code>.
            </div>
            <div className="text-muted">
              Touching {totalEventsAffected.toLocaleString()} event
              {totalEventsAffected === 1 ? "" : "s"}.
            </div>
            <div className="text-muted text-[0.75rem] mt-2">
              This cannot be undone. Consider backing up{" "}
              <code className="font-mono">delta2.db</code> first.
            </div>
          </div>

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
            onClick={handleConfirm}
            disabled={busy}
            className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
