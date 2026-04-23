"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { useTableSelection } from "@/components/use-table-selection";
import { cn } from "@/lib/cn";

export interface Column<T> {
  header: string;
  width?: string; // tailwind width class, e.g. "w-24", "w-40"
  align?: "left" | "right";
  className?: string; // extra td classes (font, tabular-nums, etc.)
  render: (row: T) => ReactNode;
}

/**
 * Generic checkbox-selectable table used by the Metrics / Sports / Exercises
 * data tabs. Handles the shared chrome (search toolbar, merge/clear buttons,
 * header row, body rows with checkbox column, empty state, "filtered N of M"
 * suffix). The caller owns the per-kind column render logic and the merge
 * modal it renders via `renderMergeModal`.
 *
 * Row click-through: if `rowHref` is provided, the first data cell gets a
 * `<Link absolute inset-0>` overlay and the `<tr>` + checkbox cell pick up
 * `relative` / `relative z-10` so the checkbox still receives clicks.
 */
export function SelectableDataTable<T, K>({
  rows,
  columns,
  getKey,
  filterTextFn,
  filterPlaceholder,
  emptyState,
  itemLabel,
  rowHref,
  rowHrefAriaLabel,
  renderMergeModal,
}: {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => K;
  filterTextFn?: (row: T) => string;
  filterPlaceholder?: string;
  emptyState: string | ((filter: string) => string);
  itemLabel: { one: string; many: string };
  rowHref?: (row: T) => string;
  rowHrefAriaLabel?: (row: T) => string;
  renderMergeModal?: (args: {
    selectedRows: T[];
    onClose: () => void;
  }) => ReactNode;
}) {
  const s = useTableSelection(rows, getKey, filterTextFn);
  const colCount = columns.length + 1; // +1 for checkbox column

  return (
    <div>
      {(filterTextFn || renderMergeModal) && (
        <div className="mb-3 flex items-center gap-3">
          {filterTextFn && (
            <input
              type="search"
              value={s.filter}
              onChange={(e) => s.setFilter(e.target.value)}
              placeholder={filterPlaceholder ?? "Filter..."}
              className="w-full max-w-xs px-3 py-1.5 border border-border rounded text-[0.875rem]"
            />
          )}
          {renderMergeModal && s.selected.size > 0 && (
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
      )}

      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
            <tr>
              <th className="w-8 px-2 py-2" />
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={cn(
                    "font-mono font-semibold px-3 py-2",
                    col.align === "right" ? "text-right" : "text-left",
                    col.width,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-3 py-6 text-center text-muted text-[0.8125rem]"
                >
                  {typeof emptyState === "function" ? emptyState(s.filter) : emptyState}
                </td>
              </tr>
            ) : (
              s.filtered.map((row) => {
                const checked = s.isSelected(row);
                const href = rowHref?.(row);
                return (
                  <tr
                    key={String(getKey(row))}
                    className={cn(
                      "border-t border-border hover:bg-surface/40",
                      href && "relative",
                      checked && "bg-surface/60",
                    )}
                  >
                    <td className={cn("px-2 py-2 text-center", href && "relative z-10")}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => s.toggle(row)}
                        aria-label={`Select ${rowHrefAriaLabel?.(row) ?? String(getKey(row))}`}
                      />
                    </td>
                    {columns.map((col, i) => (
                      <td
                        key={i}
                        className={cn(
                          "px-3 py-2",
                          col.align === "right" && "text-right",
                          col.className,
                        )}
                      >
                        {i === 0 && href && (
                          <Link
                            href={href}
                            className="absolute inset-0"
                            aria-label={rowHrefAriaLabel?.(row) ?? `Open`}
                          />
                        )}
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filterTextFn && s.filter && (
        <div className="mt-2 text-[0.75rem] text-muted">
          {s.filtered.length} of {rows.length}{" "}
          {rows.length === 1 ? itemLabel.one : itemLabel.many}
        </div>
      )}

      {renderMergeModal && s.mergeOpen && s.selectedRows.length >= 2 &&
        renderMergeModal({
          selectedRows: s.selectedRows,
          onClose: s.closeMergeAndClear,
        })}
    </div>
  );
}
