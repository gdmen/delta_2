"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface MergeCandidate {
  id: number;
  name: string;
  unit: string;
  count: number;
}

interface Props {
  candidates: MergeCandidate[]; // the selected rows
  onClose: () => void;
}

/**
 * Merge modal. User picks which of the selected metric_types is the canonical;
 * the others get their rows re-pointed, an alias row inserted for future
 * ingests, and then deleted. Unit mismatches require an opt-in rescale.
 */
export function MergeModal({ candidates, onClose }: Props) {
  const router = useRouter();
  const [canonicalId, setCanonicalId] = useState<number>(
    // Default to the row with the most data — least likely to be the orphan.
    candidates.reduce((a, b) => (a.count >= b.count ? a : b)).id
  );
  const [rescale, setRescale] = useState(false);
  const [scales, setScales] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canonical = candidates.find((c) => c.id === canonicalId)!;
  const merged = candidates.filter((c) => c.id !== canonicalId);
  const unitMismatch = merged.some((m) => m.unit !== canonical.unit);
  const totalMoved = merged.reduce((sum, m) => sum + m.count, 0);

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!unitMismatch) return true;
    if (!rescale) return false;
    return merged.every((m) => {
      const v = Number(scales[m.id]);
      return Number.isFinite(v) && v !== 0;
    });
  }, [busy, unitMismatch, rescale, merged, scales]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
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
          merged.map((m) => [m.id, Number(scales[m.id])])
        );
      }
      const res = await fetch("/api/metric-types/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
          <h2 className="text-lg font-semibold">Merge {candidates.length} metric types</h2>
          <p className="text-[0.8125rem] text-text-secondary mt-1">
            Pick which name wins. Rows from the other types move to the canonical,
            future imports under those names route here, and the merged types are
            deleted.
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
                Merging across units without rescaling will mix incompatible
                values. Provide a multiplier to apply to each merged type&apos;s
                stored values.
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
              <span className="font-mono">{totalMoved.toLocaleString()}</span> rows
              move to <code className="font-mono">{canonical.name}</code>.
            </div>
            <div>
              <span className="font-mono">{merged.length}</span> metric{merged.length === 1 ? "" : "s"}
              {" "}deleted and aliased.
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
            disabled={!canSubmit}
            className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
