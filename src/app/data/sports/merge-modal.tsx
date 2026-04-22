"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SportMergeCandidate {
  id: number;
  name: string;
  color: string;
  eventCount: number;
  focusCount: number;
  goalCount: number;
}

interface Props {
  candidates: SportMergeCandidate[];
  onClose: () => void;
}

/**
 * Merge modal for sports. Simpler than the metric-types merge: no units,
 * no rescaling, no daily_summaries — just re-point events / focuses / goals
 * / metric_types.sport_id from the merged rows to the canonical, then delete
 * the merged sports.
 */
export function SportsMergeModal({ candidates, onClose }: Props) {
  const router = useRouter();
  const [canonicalId, setCanonicalId] = useState<number>(
    candidates.reduce((a, b) => (a.eventCount >= b.eventCount ? a : b)).id,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canonical = candidates.find((c) => c.id === canonicalId)!;
  const merged = candidates.filter((c) => c.id !== canonicalId);
  const totalEventsMoved = merged.reduce((sum, m) => sum + m.eventCount, 0);
  const totalFocusesMoved = merged.reduce((sum, m) => sum + m.focusCount, 0);
  const totalGoalsMoved = merged.reduce((sum, m) => sum + m.goalCount, 0);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sports/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalId,
          mergeIds: merged.map((m) => m.id),
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
          <h2 className="text-lg font-semibold">Merge {candidates.length} sports</h2>
          <p className="text-[0.8125rem] text-text-secondary mt-1">
            Pick which name wins. Events, focuses, and goals attached to the
            other sports move to the canonical. Merged sports are deleted.
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
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 border border-border rounded cursor-pointer hover:bg-surface"
                >
                  <input
                    type="radio"
                    name="canonical"
                    checked={canonicalId === c.id}
                    onChange={() => setCanonicalId(c.id)}
                  />
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <div className="flex-1 flex items-baseline justify-between gap-2 min-w-0">
                    <span className="font-mono text-[0.875rem] truncate">{c.name}</span>
                    <span className="font-mono text-[0.6875rem] text-muted shrink-0">
                      {c.eventCount.toLocaleString()} event{c.eventCount === 1 ? "" : "s"}
                      {c.focusCount > 0 && ` · ${c.focusCount} focus${c.focusCount === 1 ? "" : "es"}`}
                      {c.goalCount > 0 && ` · ${c.goalCount} goal${c.goalCount === 1 ? "" : "s"}`}
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
              <span className="font-mono">{totalEventsMoved.toLocaleString()}</span>{" "}
              event{totalEventsMoved === 1 ? "" : "s"} move to{" "}
              <code className="font-mono">{canonical.name}</code>.
            </div>
            {totalFocusesMoved > 0 && (
              <div>
                <span className="font-mono">{totalFocusesMoved}</span> focus
                {totalFocusesMoved === 1 ? "" : "es"} retargeted.
              </div>
            )}
            {totalGoalsMoved > 0 && (
              <div>
                <span className="font-mono">{totalGoalsMoved}</span> goal
                {totalGoalsMoved === 1 ? "" : "s"} retargeted.
              </div>
            )}
            <div>
              <span className="font-mono">{merged.length}</span> sport
              {merged.length === 1 ? "" : "s"} deleted.
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
