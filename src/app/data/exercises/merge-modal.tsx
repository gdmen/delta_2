"use client";

import { useState } from "react";
import { pickMaxBy } from "@/lib/collections";
import { MergeModalShell } from "@/components/merge-modal-shell";
import { useMergeSubmit } from "@/components/use-merge-submit";

export interface ExerciseMergeCandidate {
  name: string;
  sets: number;
  eventCount: number;
}

export function ExercisesMergeModal({
  candidates,
  onClose,
}: {
  candidates: ExerciseMergeCandidate[];
  onClose: () => void;
}) {
  const [canonical, setCanonical] = useState<string>(
    pickMaxBy(candidates, (c) => c.sets).name,
  );
  const { busy, error, submit } = useMergeSubmit("/api/exercises/merge", onClose);

  const merged = candidates.filter((c) => c.name !== canonical);
  const totalSetsMoved = merged.reduce((sum, m) => sum + m.sets, 0);
  const totalEventsAffected = merged.reduce((sum, m) => sum + m.eventCount, 0);

  function handleConfirm() {
    void submit({ canonical, mergeNames: merged.map((m) => m.name) });
  }

  return (
    <MergeModalShell
      title={`Merge ${candidates.length} exercises`}
      description="Pick the canonical name. Sets recorded under the other names are rewritten to use it."
      busy={busy}
      canSubmit={true}
      error={error}
      onClose={onClose}
      onConfirm={handleConfirm}
    >
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
    </MergeModalShell>
  );
}
