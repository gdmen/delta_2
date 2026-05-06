"use client";

import { useState } from "react";
import { pickMaxBy } from "@/lib/collections";
import { MergeModalShell } from "@/components/merge-modal-shell";
import { useMergeSubmit } from "@/components/use-merge-submit";

export interface SportMergeCandidate {
  id: number;
  name: string;
  color: string;
  eventCount: number;
  focusCount: number;
  goalCount: number;
}

export function SportsMergeModal({
  candidates,
  onClose,
}: {
  candidates: SportMergeCandidate[];
  onClose: () => void;
}) {
  const [canonicalId, setCanonicalId] = useState<number>(
    pickMaxBy(candidates, (c) => c.eventCount).id,
  );
  const { busy, error, submit } = useMergeSubmit("/api/sports/merge", onClose, "sport");

  const canonical = candidates.find((c) => c.id === canonicalId)!;
  const merged = candidates.filter((c) => c.id !== canonicalId);
  const totalEventsMoved = merged.reduce((sum, m) => sum + m.eventCount, 0);
  const totalFocusesMoved = merged.reduce((sum, m) => sum + m.focusCount, 0);
  const totalGoalsMoved = merged.reduce((sum, m) => sum + m.goalCount, 0);

  function handleConfirm() {
    void submit({ canonicalId, mergeIds: merged.map((m) => m.id) });
  }

  return (
    <MergeModalShell
      title={`Merge ${candidates.length} sports`}
      description="Pick which name wins. Events, focuses, and goals attached to the other sports move to the canonical. Merged sports are deleted."
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
                  {c.eventCount.toLocaleString()} event
                  {c.eventCount === 1 ? "" : "s"}
                  {c.focusCount > 0 &&
                    ` · ${c.focusCount} focus${c.focusCount === 1 ? "" : "es"}`}
                  {c.goalCount > 0 &&
                    ` · ${c.goalCount} goal${c.goalCount === 1 ? "" : "s"}`}
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
          You can undo this merge from Recent merges.
        </div>
      </div>
    </MergeModalShell>
  );
}
