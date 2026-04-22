"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SportsMergeModal, type SportMergeCandidate } from "./merge-modal";
import { formatShort } from "@/lib/format";

interface SportRow {
  id: number;
  name: string;
  color: string;
  eventCount: number;
  focusCount: number;
  goalCount: number;
  lastEventAt: string | null;
}

export function SportsTable({ rows }: { rows: SportRow[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );

  const mergeCandidates: SportMergeCandidate[] = selectedRows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    eventCount: r.eventCount,
    focusCount: r.focusCount,
    goalCount: r.goalCount,
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
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3">
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
        </div>
      )}
      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="text-left font-mono font-semibold px-3 py-2">Sport</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-20">Events</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-20">Focuses</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-16">Goals</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-40">Last event</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted text-[0.8125rem]">
                  No sports yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const checked = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`relative border-t border-border hover:bg-surface/40 ${
                      checked ? "bg-surface/60" : ""
                    }`}
                  >
                    <td className="px-2 py-2 text-center relative z-10">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <Link
                        href={`/sports/${encodeURIComponent(r.name)}`}
                        className="absolute inset-0"
                        aria-label={`Open ${r.name}`}
                      />
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                        style={{ backgroundColor: r.color }}
                      />
                      {r.name}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.eventCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {r.focusCount || "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {r.goalCount || "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {r.lastEventAt ? formatShort(r.lastEventAt) : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {mergeOpen && selectedRows.length >= 2 && (
        <SportsMergeModal
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
