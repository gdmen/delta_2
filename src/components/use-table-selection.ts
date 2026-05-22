"use client";

import { useMemo, useState } from "react";
import { useRowSelection } from "@/components/use-row-selection";

export type SortDir = "asc" | "desc";
export type SortState = { colIdx: number; dir: SortDir } | null;

/**
 * Catalog-table state: filter + sort + the shared row-selection machine +
 * merge/delete chrome (metrics, sports, exercises, aliases). The selection
 * itself lives in `useRowSelection` (shared with the events list and the
 * duplicates view); this hook layers the catalog-only concerns on top and
 * adapts the key-based selection API to the row objects the table renders.
 *
 * Default order is whatever the caller passed in (caller-controlled, e.g.
 * metrics sorted by row-count desc). Clicking a sortable header overrides
 * it; clicking again flips direction; a third click clears (back to the
 * caller's default order).
 */
export function useTableSelection<T, K>(
  rows: readonly T[],
  getKey: (row: T) => K,
  filterText?: (row: T) => string,
  sortBys?: (((row: T) => string | number | null) | undefined)[],
) {
  const [filter, setFilter] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(null);

  const filteredAndSorted = useMemo(() => {
    let result: T[];
    if (!filterText) {
      result = [...rows];
    } else {
      const needle = filter.trim().toLowerCase();
      result = needle
        ? rows.filter((r) => filterText(r).toLowerCase().includes(needle))
        : [...rows];
    }
    if (sort && sortBys) {
      const extract = sortBys[sort.colIdx];
      if (extract) {
        const dir = sort.dir === "asc" ? 1 : -1;
        result.sort((a, b) => {
          const av = extract(a);
          const bv = extract(b);
          // Nulls always sink to the bottom regardless of direction.
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
          return 0;
        });
      }
    }
    return result;
  }, [rows, filter, filterText, sort, sortBys]);
  const filtered = filteredAndSorted;

  // The selectable keys, in display order, are the currently-filtered rows.
  // "select all" / the tri-state header therefore mean "all visible," and
  // selections of rows hidden by the filter are preserved (see the hook's
  // selectAll/clearVisible). That matches user intent for the common case:
  // filter to `bodyspec_dexa:`, select all, bulk-edit — without silently
  // sweeping in the hidden rows.
  const sel = useRowSelection<K>(filtered.map(getKey));

  const selectedRows = useMemo(
    () => rows.filter((r) => sel.selected.has(getKey(r))),
    [rows, sel.selected, getKey],
  );

  /** Click-handler for a sortable column header. Cycles
   * none -> asc -> desc -> none for the same column; resets to asc when
   * switching columns. */
  function toggleSort(colIdx: number) {
    setSort((prev) => {
      if (!prev || prev.colIdx !== colIdx) return { colIdx, dir: "asc" };
      if (prev.dir === "asc") return { colIdx, dir: "desc" };
      return null;
    });
  }

  // Bulk-delete progress state. `busy` blocks repeated clicks. `errorMsg`
  // surfaces a one-line summary; per-row errors are returned by the caller.
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  return {
    filter,
    setFilter,
    filtered,
    selected: sel.selected,
    isSelected: (row: T) => sel.isSelected(getKey(row)),
    toggle: (row: T) => sel.toggle(getKey(row)),
    toggleRange: (row: T, withShift: boolean) =>
      sel.toggleRange(getKey(row), withShift),
    clearSelection: sel.clearSelection,
    selectedRows,
    filteredAllSelected: sel.allSelected,
    filteredSomeSelected: sel.someSelected,
    selectAllFiltered: sel.selectAll,
    clearFilteredSelection: sel.clearVisible,
    mergeOpen,
    openMerge: () => setMergeOpen(true),
    closeMergeAndClear: () => {
      setMergeOpen(false);
      sel.clearSelection();
    },
    busy,
    setBusy,
    errorMsg,
    setErrorMsg,
    sort,
    toggleSort,
  };
}
