"use client";

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState = { colIdx: number; dir: SortDir } | null;

/**
 * Shared selection + filter + sort state for the data-tab tables
 * (metrics, sports, exercises, aliases). Each row is keyed by whatever
 * `getKey` returns; pass a `filterText` extractor to enable the
 * search-input path; pass per-column `sortBy` extractors via
 * SelectableDataTable's columns array to enable click-to-sort.
 *
 * Default order is whatever the caller passed in (caller-controlled,
 * e.g. metrics sorted by row-count desc). User clicking a sortable
 * header overrides it; clicking the same header again flips direction;
 * clicking a third time clears (returns to caller's default order).
 */
export function useTableSelection<T, K>(
  rows: readonly T[],
  getKey: (row: T) => K,
  filterText?: (row: T) => string,
  sortBys?: (((row: T) => string | number | null) | undefined)[],
) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<K>>(new Set());
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

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(getKey(r))),
    [rows, selected, getKey],
  );

  function isSelected(row: T) {
    return selected.has(getKey(row));
  }

  function toggle(row: T) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = getKey(row);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Bulk-delete progress state. `busy` blocks repeated clicks.
  // `errorMsg` surfaces a one-line summary for the user; per-row errors
  // are returned by the caller via the result object.
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** Click-handler for a sortable column header. Cycles
   * none -> asc -> desc -> none for the same column; resets to asc
   * when switching columns. */
  function toggleSort(colIdx: number) {
    setSort((prev) => {
      if (!prev || prev.colIdx !== colIdx) return { colIdx, dir: "asc" };
      if (prev.dir === "asc") return { colIdx, dir: "desc" };
      return null;
    });
  }

  return {
    filter,
    setFilter,
    filtered,
    selected,
    isSelected,
    toggle,
    clearSelection,
    selectedRows,
    mergeOpen,
    openMerge: () => setMergeOpen(true),
    closeMergeAndClear: () => {
      setMergeOpen(false);
      clearSelection();
    },
    busy,
    setBusy,
    errorMsg,
    setErrorMsg,
    sort,
    toggleSort,
  };
}
