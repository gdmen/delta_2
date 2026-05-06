"use client";

import { useState } from "react";
import { pickMaxBy } from "@/lib/collections";
import { MergeModalShell } from "@/components/merge-modal-shell";
import { useMergeSubmit } from "@/components/use-merge-submit";

export interface MergeCandidate {
  id: number;
  name: string;
  unit: string;
  count: number;
}

export function MergeModal({
  candidates,
  onClose,
}: {
  candidates: MergeCandidate[];
  onClose: () => void;
}) {
  // Default to the row with the most data — least likely to be the orphan.
  const [canonicalId, setCanonicalId] = useState<number>(
    pickMaxBy(candidates, (c) => c.count).id,
  );
  const [rescale, setRescale] = useState(false);
  const [scales, setScales] = useState<Record<number, string>>({});
  const { busy, error, submit } = useMergeSubmit("/api/metric-types/merge", onClose, "metric_type");

  const canonical = candidates.find((c) => c.id === canonicalId)!;
  const merged = candidates.filter((c) => c.id !== canonicalId);
  const unitMismatch = merged.some((m) => m.unit !== canonical.unit);
  const totalMoved = merged.reduce((sum, m) => sum + m.count, 0);

  const canSubmit =
    !unitMismatch ||
    (rescale &&
      merged.every((m) => {
        const v = Number(scales[m.id]);
        return Number.isFinite(v) && v !== 0;
      }));

  function handleConfirm() {
    const body: {
      canonicalId: number;
      mergeIds: number[];
      unitPolicy: "block" | "rescale";
      scales?: Record<number, number>;
    } = {
      canonicalId,
      mergeIds: merged.map((m) => m.id),
      unitPolicy: unitMismatch && rescale ? "rescale" : "block",
    };
    if (unitMismatch && rescale) {
      body.scales = Object.fromEntries(
        merged.map((m) => [m.id, Number(scales[m.id])]),
      );
    }
    void submit(body);
  }

  return (
    <MergeModalShell
      title={`Merge ${candidates.length} metric types`}
      description="Pick which name wins. Rows from the other types move to the canonical, future imports under those names route here, and the merged types are deleted."
      busy={busy}
      canSubmit={canSubmit}
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
              <div className="flex-1 flex items-baseline justify-between gap-2 min-w-0">
                <span className="font-mono text-[0.875rem] truncate">{c.name}</span>
                <span className="font-mono text-[0.6875rem] text-muted shrink-0">
                  {c.count.toLocaleString()} rows · {c.unit || "—"}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {unitMismatch && (
        <div className="border border-border rounded p-3 bg-surface/40">
          <div className="flex items-start gap-2 mb-2">
            <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
              Unit mismatch
            </span>
          </div>
          <p className="text-[0.8125rem] mb-3">
            Canonical is <code className="font-mono">{canonical.unit || "—"}</code>.
            Merging across units without rescaling will mix incompatible values.
            Provide a multiplier to apply to each merged type&apos;s stored values.
          </p>
          <label className="flex items-center gap-2 text-[0.8125rem] mb-3">
            <input
              type="checkbox"
              checked={rescale}
              onChange={(e) => setRescale(e.target.checked)}
            />
            Rescale values during merge
          </label>
          {rescale && (
            <div className="space-y-2">
              {merged.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-[0.8125rem]">
                  <span className="font-mono flex-1 truncate">{m.name}</span>
                  <span className="text-muted">({m.unit || "—"})</span>
                  <span className="text-muted">×</span>
                  <input
                    type="number"
                    step="any"
                    placeholder="1.0"
                    value={scales[m.id] ?? ""}
                    onChange={(e) =>
                      setScales((s) => ({ ...s, [m.id]: e.target.value }))
                    }
                    className="w-24 px-2 py-1 border border-border rounded font-mono text-[0.8125rem]"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border border-border rounded p-3 text-[0.8125rem] space-y-1">
        <div className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-1">
          Summary
        </div>
        <div>
          <span className="font-mono">{totalMoved.toLocaleString()}</span> rows move
          to <code className="font-mono">{canonical.name}</code>.
        </div>
        <div>
          <span className="font-mono">{merged.length}</span> metric
          {merged.length === 1 ? "" : "s"} deleted and aliased.
        </div>
        <div className="text-muted text-[0.75rem] mt-2">
          You can undo this merge from Recent merges.
        </div>
      </div>
    </MergeModalShell>
  );
}
