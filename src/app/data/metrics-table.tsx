"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MergeModal, type MergeCandidate } from "./merge-modal";
import { formatShort } from "@/lib/format";

interface MetricTypeRow {
  id: number;
  name: string;
  unit: string;
  count: number;
  lastAt: string | null;
}

export function MetricsTable({ rows }: { rows: MetricTypeRow[] }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(needle));
  }, [rows, q]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected]
  );

  const mergeCandidates: MergeCandidate[] = selectedRows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    count: r.count,
  }));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter metrics..."
          className="w-full max-w-xs px-3 py-1.5 border border-border rounded text-[0.875rem]"
        />
        {selected.size > 0 && (
          <>
            <button
              type="button"
              onClick={() => setMergeOpen(true)}
              disabled={selected.size < 2}
              className="px-3 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
            >
              Merge {selected.size} selected…
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground"
            >
              Clear
            </button>
          </>
        )}
      </div>
      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="text-left font-mono font-semibold px-3 py-2">Metric</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-24">Rows</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-40">Last</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted text-[0.8125rem]">
                  No metrics match &quot;{q}&quot;.
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const checked = selected.has(t.id);
                return (
                  <tr
                    key={t.id}
                    className={`relative border-t border-border hover:bg-surface/40 ${
                      checked ? "bg-surface/60" : ""
                    }`}
                  >
                    <td className="px-2 py-2 text-center relative z-10">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(t.id)}
                        aria-label={`Select ${t.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <Link
                        href={`/data/metrics/${encodeURIComponent(t.name)}`}
                        className="absolute inset-0"
                        aria-label={`Open ${t.name}`}
                      />
                      {t.name}
                      {t.unit && <span className="text-muted"> ({t.unit})</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {t.count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {t.lastAt ? formatShort(t.lastAt) : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {q && (
        <div className="mt-2 text-[0.75rem] text-muted">
          {filtered.length} of {rows.length} metric{rows.length === 1 ? "" : "s"}
        </div>
      )}

      {mergeOpen && selectedRows.length >= 2 && (
        <MergeModal
          candidates={mergeCandidates}
          onClose={() => {
            setMergeOpen(false);
            clearSelection();
          }}
        />
      )}
    </div>
  );
}

