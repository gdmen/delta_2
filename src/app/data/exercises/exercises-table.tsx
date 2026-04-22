"use client";

import { ExercisesMergeModal } from "./merge-modal";
import { formatShort } from "@/lib/format";
import { useTableSelection } from "@/components/use-table-selection";

interface ExerciseRow {
  name: string;
  sets: number;
  eventCount: number;
  firstAt: string | null;
  lastAt: string | null;
}

export function ExercisesTable({ rows }: { rows: ExerciseRow[] }) {
  const s = useTableSelection(
    rows,
    (r) => r.name,
    (r) => r.name,
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <input
          type="search"
          value={s.filter}
          onChange={(e) => s.setFilter(e.target.value)}
          placeholder="Filter exercises..."
          className="w-full max-w-xs px-3 py-1.5 border border-border rounded text-[0.875rem]"
        />
        {s.selected.size > 0 && (
          <>
            <button
              type="button"
              onClick={s.openMerge}
              disabled={s.selected.size < 2}
              className="px-3 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
            >
              Merge {s.selected.size} selected…
            </button>
            <button
              type="button"
              onClick={s.clearSelection}
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
              <th className="text-left font-mono font-semibold px-3 py-2">Exercise</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-20">Sets</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-24">Events</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-40">First</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-40">Last</th>
            </tr>
          </thead>
          <tbody>
            {s.filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted text-[0.8125rem]">
                  {rows.length === 0
                    ? "No exercises yet — import a workout_sets CSV."
                    : `No exercises match "${s.filter}".`}
                </td>
              </tr>
            ) : (
              s.filtered.map((r) => {
                const checked = s.isSelected(r);
                return (
                  <tr
                    key={r.name}
                    className={`border-t border-border hover:bg-surface/40 ${
                      checked ? "bg-surface/60" : ""
                    }`}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => s.toggle(r)}
                        aria-label={`Select ${r.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.sets.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {r.eventCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {r.firstAt ? formatShort(r.firstAt) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {r.lastAt ? formatShort(r.lastAt) : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {s.filter && (
        <div className="mt-2 text-[0.75rem] text-muted">
          {s.filtered.length} of {rows.length} exercise{rows.length === 1 ? "" : "s"}
        </div>
      )}

      {s.mergeOpen && s.selectedRows.length >= 2 && (
        <ExercisesMergeModal
          candidates={s.selectedRows.map((r) => ({
            name: r.name,
            sets: r.sets,
            eventCount: r.eventCount,
          }))}
          onClose={s.closeMergeAndClear}
        />
      )}
    </div>
  );
}
